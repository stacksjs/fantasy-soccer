#!/usr/bin/env bun
/**
 * Transfermarkt Premier League Player Scraper
 *
 * Scrapes all teams from the Premier League, then visits each team
 * to get all players and downloads their profile images.
 */

import { createScraper } from 'ts-web-scraper'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const BASE_URL = 'https://www.transfermarkt.com'
const PREMIER_LEAGUE_URL = `${BASE_URL}/premier-league/startseite/wettbewerb/GB1`

// Output directories
const PROJECT_ROOT = join(import.meta.dir, '..')
const IMAGES_DIR = join(PROJECT_ROOT, 'public/images/players')
const DATA_DIR = join(PROJECT_ROOT, 'data/players')

interface Team {
  name: string
  url: string
  slug: string
  id: string
}

interface Player {
  id: string
  name: string
  url: string
  imageUrl: string | null
  localImagePath: string | null
  position: string | null
  number: string | null
  team: string
  teamSlug: string
}

// Create scraper with respectful rate limiting
const scraper = createScraper({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  rateLimit: {
    requestsPerSecond: 2, // Be respectful to the server
  },
  retry: {
    maxRetries: 3,
    initialDelay: 2000,
  },
  cache: {
    enabled: true,
    ttl: 3600000 * 24, // 24 hour cache
  },
})

/**
 * Clean HTML entities and normalize text
 */
function cleanText(text: string | undefined | null): string {
  if (!text) return ''
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract team slug from URL
 */
function extractSlug(url: string): string {
  const parts = url.split('/')
  // URL format: /team-name/startseite/verein/123
  return parts[1] || 'unknown'
}

/**
 * Extract team/player ID from URL
 */
function extractId(url: string, type: 'verein' | 'spieler'): string {
  const match = url.match(new RegExp(`/${type}/(\\d+)`))
  return match ? match[1] : 'unknown'
}

/**
 * Construct player image URL from player ID
 * Transfermarkt image URL pattern: https://img.a.transfermarkt.technology/portrait/header/{playerId}-{timestamp}.jpg
 */
function constructImageUrl(playerId: string): string {
  // Use the standard portrait URL pattern
  return `https://img.a.transfermarkt.technology/portrait/header/${playerId}.jpg`
}

/**
 * Scrape all teams from the Premier League page
 */
async function scrapeTeams(): Promise<Team[]> {
  console.log('📋 Scraping Premier League teams...')

  const result = await scraper.scrape(PREMIER_LEAGUE_URL, {
    extract: (doc) => {
      const teams: Team[] = []
      const seenIds = new Set<string>()

      // Find all links to team pages (format: /team-name/startseite/verein/123)
      const allLinks = doc.querySelectorAll('a')

      for (const link of allLinks) {
        const href = link.getAttribute('href')
        let name = cleanText(link.textContent)

        // Match pattern: /team-name/startseite/verein/123
        if (href && name && /^\/[^/]+\/startseite\/verein\/\d+/.test(href)) {
          // Skip if name is empty or just whitespace
          if (!name || name.length < 3) continue
          // Skip navigation/header links (usually short or numeric)
          if (/^\d+$/.test(name)) continue

          const teamId = extractId(href, 'verein')

          // Skip if we've already seen this team ID
          if (seenIds.has(teamId)) continue
          seenIds.add(teamId)

          teams.push({
            name,
            url: `${BASE_URL}${href.split('/saison_id')[0]}`, // Remove season suffix
            slug: extractSlug(href),
            id: teamId,
          })
        }
      }

      return teams
    },
  })

  // Keep only the first 20 teams (Premier League has 20 teams)
  // This filters out any championship or other teams that might appear
  const premierLeagueTeams = result.data.slice(0, 20)

  console.log(`✅ Found ${premierLeagueTeams.length} teams`)
  return premierLeagueTeams
}

/**
 * Scrape all players from a team page
 */
async function scrapeTeamPlayers(team: Team): Promise<Player[]> {
  console.log(`  👥 Scraping players from ${team.name}...`)

  // Convert URL to squad page (kader = squad in German)
  const squadUrl = team.url.replace('/startseite/', '/kader/')

  const result = await scraper.scrape(squadUrl, {
    extract: (doc) => {
      const players: Player[] = []
      const seenIds = new Set<string>()

      // Find all player links (format: /player-name/profil/spieler/123)
      const allLinks = doc.querySelectorAll('a')

      for (const link of allLinks) {
        const href = link.getAttribute('href')
        let name = cleanText(link.textContent)

        // Match player profile pattern
        if (href && name && /^\/[^/]+\/profil\/spieler\/\d+/.test(href)) {
          // Skip empty names or very short names
          if (!name || name.length < 2) continue
          // Skip numeric-only entries
          if (/^\d+$/.test(name)) continue

          const playerId = extractId(href, 'spieler')

          // Skip if we've already seen this player ID
          if (seenIds.has(playerId)) continue
          seenIds.add(playerId)

          const fullUrl = `${BASE_URL}${href}`
          const imageUrl = constructImageUrl(playerId)

          players.push({
            id: playerId,
            name,
            url: fullUrl,
            imageUrl,
            localImagePath: null,
            position: null,
            number: null,
            team: team.name,
            teamSlug: team.slug,
          })
        }
      }

      return players
    },
  })

  console.log(`    ✅ Found ${result.data.length} players`)
  return result.data
}

/**
 * Download a player's profile image
 */
async function downloadPlayerImage(player: Player): Promise<string | null> {
  if (!player.imageUrl) {
    return null
  }

  try {
    const response = await fetch(player.imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': BASE_URL,
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    })

    if (!response.ok) {
      // Try alternative URL pattern with timestamp
      const altUrl = player.imageUrl.replace('.jpg', '-1.jpg')
      const altResponse = await fetch(altUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': BASE_URL,
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
      })

      if (!altResponse.ok) {
        return null
      }

      const buffer = await altResponse.arrayBuffer()
      return await saveImage(player, buffer)
    }

    const buffer = await response.arrayBuffer()
    return await saveImage(player, buffer)
  } catch {
    return null
  }
}

/**
 * Save image buffer to file
 */
async function saveImage(player: Player, buffer: ArrayBuffer): Promise<string | null> {
  if (buffer.byteLength < 1000) {
    // Too small, probably an error/placeholder
    return null
  }

  // Create team directory
  const teamDir = join(IMAGES_DIR, player.teamSlug)
  await mkdir(teamDir, { recursive: true })

  // Use player ID for filename (more reliable than name)
  const fileName = `${player.id}.jpg`
  const filePath = join(teamDir, fileName)

  await writeFile(filePath, Buffer.from(buffer))

  return `public/images/players/${player.teamSlug}/${fileName}`
}

/**
 * Main scraping function
 */
async function main() {
  console.log('⚽ Transfermarkt Premier League Player Scraper')
  console.log('=' .repeat(50))

  // Ensure directories exist
  await mkdir(IMAGES_DIR, { recursive: true })
  await mkdir(DATA_DIR, { recursive: true })

  // Step 1: Get all teams
  const teams = await scrapeTeams()

  console.log('\n📋 Teams to scrape:')
  teams.forEach((t, i) => console.log(`  ${i + 1}. ${t.name}`))

  // Step 2: Get all players from each team
  const allPlayers: Player[] = []

  console.log('\n🏃 Scraping players...')
  for (const team of teams) {
    try {
      const players = await scrapeTeamPlayers(team)
      allPlayers.push(...players)

      // Small delay between teams
      await new Promise(resolve => setTimeout(resolve, 500))
    } catch (error) {
      console.error(`  ❌ Error scraping ${team.name}:`, error)
    }
  }

  console.log(`\n📊 Total players found: ${allPlayers.length}`)
  console.log('\n📸 Downloading player images...')

  // Step 3: Download images
  let downloadedCount = 0
  let failedCount = 0

  for (let i = 0; i < allPlayers.length; i++) {
    const player = allPlayers[i]
    const progress = `${i + 1}/${allPlayers.length}`
    process.stdout.write(`\r  [${progress}] Downloading: ${player.name.substring(0, 25).padEnd(25)}`)

    const localPath = await downloadPlayerImage(player)
    if (localPath) {
      player.localImagePath = localPath
      downloadedCount++
    } else {
      failedCount++
    }

    // Small delay between downloads
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  console.log(`\n\n✅ Downloaded ${downloadedCount} images`)
  if (failedCount > 0) {
    console.log(`⚠️ Failed to download ${failedCount} images (some players may not have photos)`)
  }

  // Step 4: Save player data
  const outputFile = join(DATA_DIR, 'premier-league.json')
  await writeFile(outputFile, JSON.stringify(allPlayers, null, 2))
  console.log(`\n💾 Player data saved to ${outputFile}`)

  // Also save per-team data
  const playersByTeam = new Map<string, Player[]>()
  for (const player of allPlayers) {
    const teamPlayers = playersByTeam.get(player.teamSlug) || []
    teamPlayers.push(player)
    playersByTeam.set(player.teamSlug, teamPlayers)
  }

  for (const [teamSlug, players] of playersByTeam) {
    const teamFile = join(DATA_DIR, `${teamSlug}.json`)
    await writeFile(teamFile, JSON.stringify(players, null, 2))
  }

  console.log(`📁 Individual team data saved to ${DATA_DIR}/`)

  // Print summary
  console.log('\n' + '=' .repeat(50))
  console.log('📈 Summary by Team:')
  for (const [teamSlug, players] of playersByTeam) {
    const withImages = players.filter(p => p.localImagePath).length
    console.log(`  ${teamSlug}: ${players.length} players (${withImages} with images)`)
  }

  console.log('\n✨ Scraping complete!')
}

// Run the scraper
main().catch(console.error)
