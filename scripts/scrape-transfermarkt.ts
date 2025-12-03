#!/usr/bin/env bun
/**
 * Transfermarkt Premier League Player Scraper
 *
 * Scrapes all teams from the Premier League, then visits each team
 * to get all players, then visits each player's profile to get
 * full metadata and profile images.
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
  team: string
  teamSlug: string
  // Metadata from profile page
  dateOfBirth: string | null
  age: number | null
  placeOfBirth: string | null
  citizenship: string[] | null
  height: string | null
  position: string | null
  foot: string | null
  currentClub: string | null
  joined: string | null
  contractExpires: string | null
  marketValue: string | null
  shirtNumber: string | null
  agent: string | null
  internationalTeam: string | null
  internationalCaps: number | null
  internationalGoals: number | null
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
 * Parse age from string like "(27)"
 */
function parseAge(text: string): number | null {
  const match = text.match(/\((\d+)\)/)
  return match ? parseInt(match[1], 10) : null
}

/**
 * Parse caps/goals from string like "30 / 15"
 */
function parseCapsGoals(text: string): { caps: number | null; goals: number | null } {
  const match = text.match(/(\d+)\s*\/\s*(\d+)/)
  if (match) {
    return { caps: parseInt(match[1], 10), goals: parseInt(match[2], 10) }
  }
  return { caps: null, goals: null }
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

      const allLinks = doc.querySelectorAll('a')

      for (const link of allLinks) {
        const href = link.getAttribute('href')
        const name = cleanText(link.textContent)

        if (href && name && /^\/[^/]+\/startseite\/verein\/\d+/.test(href)) {
          if (!name || name.length < 3) continue
          if (/^\d+$/.test(name)) continue

          const teamId = extractId(href, 'verein')

          if (seenIds.has(teamId)) continue
          seenIds.add(teamId)

          teams.push({
            name,
            url: `${BASE_URL}${href.split('/saison_id')[0]}`,
            slug: extractSlug(href),
            id: teamId,
          })
        }
      }

      return teams
    },
  })

  // Keep only the first 20 teams (Premier League has 20 teams)
  const premierLeagueTeams = result.data.slice(0, 20)

  console.log(`✅ Found ${premierLeagueTeams.length} teams`)
  return premierLeagueTeams
}

/**
 * Scrape basic player list from a team page (just names and URLs)
 */
async function scrapeTeamPlayerList(team: Team): Promise<{ id: string; name: string; url: string }[]> {
  const squadUrl = team.url.replace('/startseite/', '/kader/')

  const result = await scraper.scrape(squadUrl, {
    extract: (doc) => {
      const players: { id: string; name: string; url: string }[] = []
      const seenIds = new Set<string>()

      const allLinks = doc.querySelectorAll('a')

      for (const link of allLinks) {
        const href = link.getAttribute('href')
        const name = cleanText(link.textContent)

        if (href && name && /^\/[^/]+\/profil\/spieler\/\d+/.test(href)) {
          if (!name || name.length < 2) continue
          if (/^\d+$/.test(name)) continue

          const playerId = extractId(href, 'spieler')

          if (seenIds.has(playerId)) continue
          seenIds.add(playerId)

          players.push({
            id: playerId,
            name,
            url: `${BASE_URL}${href}`,
          })
        }
      }

      return players
    },
  })

  return result.data
}

/**
 * Scrape full player details from their profile page
 */
async function scrapePlayerProfile(
  basicInfo: { id: string; name: string; url: string },
  team: Team
): Promise<Player> {
  const result = await scraper.scrape(basicInfo.url, {
    extract: (doc) => {
      // Get header image - prefer header size, then big
      let imageUrl: string | null = null
      const allImages = doc.querySelectorAll('img')
      for (const img of allImages) {
        const src = img.getAttribute('data-src') || img.getAttribute('src')
        if (src && src.includes('portrait')) {
          // Replace any size with header for best quality
          imageUrl = src.replace('/small/', '/header/').replace('/medium/', '/header/').replace('/big/', '/header/')
          break
        }
      }

      // Get player name with shirt number
      const nameEl = doc.querySelector('h1.data-header__headline-wrapper')
      let fullName = cleanText(nameEl?.textContent)

      // Extract shirt number from name (format: "#14 Viktor Gyökeres")
      let shirtNumber: string | null = null
      const shirtMatch = fullName.match(/#(\d+)/)
      if (shirtMatch) {
        shirtNumber = shirtMatch[1]
      }

      // Get market value - extract just the value
      let marketValue: string | null = null
      const mvElements = doc.querySelectorAll('a.data-header__market-value-wrapper')
      for (const el of mvElements) {
        const text = cleanText(el.textContent)
        if (text && text.includes('€')) {
          // Extract just the currency amount (e.g., "€75.00m")
          const mvMatch = text.match(/(€[\d,.]+[mk]?)/i)
          if (mvMatch) {
            marketValue = mvMatch[1]
          }
          break
        }
      }

      // Get the full body text for regex matching
      const bodyText = doc.querySelector('body')?.textContent || ''

      // Date of birth and age
      let dateOfBirth: string | null = null
      let age: number | null = null
      const dobPatterns = [
        /Date of birth\/Age:\s*(\d{2}\/\d{2}\/\d{4})\s*\((\d+)\)/,
        /Date of birth:\s*(\d{2}\/\d{2}\/\d{4})/,
      ]
      for (const pattern of dobPatterns) {
        const match = bodyText.match(pattern)
        if (match) {
          dateOfBirth = match[1]
          age = match[2] ? parseInt(match[2], 10) : null
          break
        }
      }

      // Place of birth
      let placeOfBirth: string | null = null
      const pobMatch = bodyText.match(/Place of birth:\s*([A-Za-zÀ-ÿ\s\-']+?)(?:\s{2,}|Citizenship|Height|Position|Foot|$)/m)
      if (pobMatch) {
        placeOfBirth = cleanText(pobMatch[1])
      }

      // Height
      let height: string | null = null
      const heightMatch = bodyText.match(/Height:\s*([\d,\.]+\s*m)/i)
      if (heightMatch) {
        height = heightMatch[1]
      }

      // Position - look for specific patterns
      let position: string | null = null
      const posPatterns = [
        /Position:\s*(?:Attack\s*-\s*|Midfield\s*-\s*|Defender\s*-\s*)?([A-Za-z\-\s]+?)(?:\s+Foot|\s+Agent|\s+Player|\s+National|$)/im,
        /Main position:\s*([A-Za-z\-\s]+)/im,
      ]
      for (const pattern of posPatterns) {
        const match = bodyText.match(pattern)
        if (match) {
          position = cleanText(match[1])
          // Clean up common trailing words
          position = position.replace(/\s*(National|Player|agent).*$/i, '').trim()
          break
        }
      }

      // Foot
      let foot: string | null = null
      const footMatch = bodyText.match(/Foot:\s*(right|left|both)/i)
      if (footMatch) {
        foot = footMatch[1].toLowerCase()
      }

      // Citizenship
      let citizenship: string[] = []
      const citizenMatch = bodyText.match(/Citizenship:\s*([A-Za-zÀ-ÿ\s]+?)(?:\s{2,}|Position|Height|Foot|$)/m)
      if (citizenMatch) {
        citizenship = citizenMatch[1].trim().split(/\s{2,}/).map(c => c.trim()).filter(c => c.length > 1)
      }

      // Agent
      let agent: string | null = null
      const agentMatch = bodyText.match(/Agent:\s*([A-Za-z\s\.\-&]+?)(?:\s+verified|\s+Current|\s{2,}|$)/im)
      if (agentMatch) {
        agent = cleanText(agentMatch[1]).replace(/\s*\.\.\.$/, '')
      }

      // Joined date
      let joined: string | null = null
      const joinedMatch = bodyText.match(/Joined:\s*(\d{2}\/\d{2}\/\d{4})/i)
      if (joinedMatch) {
        joined = joinedMatch[1]
      }

      // Contract expires
      let contractExpires: string | null = null
      const contractMatch = bodyText.match(/Contract expires:\s*(\d{2}\/\d{2}\/\d{4})/i)
      if (contractMatch) {
        contractExpires = contractMatch[1]
      }

      // Current club
      let currentClub: string | null = null
      const clubMatch = bodyText.match(/Current club:\s*([A-Za-zÀ-ÿ\s\.\-&]+?)(?:\s{2,}|Joined|Contract|$)/m)
      if (clubMatch) {
        currentClub = cleanText(clubMatch[1])
      }

      // International team and caps/goals
      let internationalTeam: string | null = null
      let internationalCaps: number | null = null
      let internationalGoals: number | null = null
      const intlMatch = bodyText.match(/Current international:\s*([A-Za-zÀ-ÿ\s]+?)\s*Caps\/Goals:\s*(\d+)\s*\/\s*(\d+)/im)
      if (intlMatch) {
        internationalTeam = cleanText(intlMatch[1])
        internationalCaps = parseInt(intlMatch[2], 10)
        internationalGoals = parseInt(intlMatch[3], 10)
      }

      return {
        imageUrl,
        shirtNumber,
        dateOfBirth,
        age,
        placeOfBirth,
        citizenship: citizenship.length > 0 ? citizenship : null,
        height,
        position,
        foot,
        currentClub,
        joined,
        contractExpires,
        marketValue,
        agent,
        internationalTeam,
        internationalCaps,
        internationalGoals,
      }
    },
  })

  return {
    id: basicInfo.id,
    name: basicInfo.name,
    url: basicInfo.url,
    imageUrl: result.data.imageUrl,
    localImagePath: null,
    team: team.name,
    teamSlug: team.slug,
    dateOfBirth: result.data.dateOfBirth,
    age: result.data.age,
    placeOfBirth: result.data.placeOfBirth,
    citizenship: result.data.citizenship,
    height: result.data.height,
    position: result.data.position,
    foot: result.data.foot,
    currentClub: result.data.currentClub,
    joined: result.data.joined,
    contractExpires: result.data.contractExpires,
    marketValue: result.data.marketValue,
    shirtNumber: result.data.shirtNumber,
    agent: result.data.agent,
    internationalTeam: result.data.internationalTeam,
    internationalCaps: result.data.internationalCaps,
    internationalGoals: result.data.internationalGoals,
  }
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
      return null
    }

    const buffer = await response.arrayBuffer()

    if (buffer.byteLength < 1000) {
      return null
    }

    // Create team directory
    const teamDir = join(IMAGES_DIR, player.teamSlug)
    await mkdir(teamDir, { recursive: true })

    // Use player ID for filename
    const fileName = `${player.id}.jpg`
    const filePath = join(teamDir, fileName)

    await writeFile(filePath, Buffer.from(buffer))

    return `public/images/players/${player.teamSlug}/${fileName}`
  } catch {
    return null
  }
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

  // Step 2: Get player list from each team
  console.log('\n🏃 Getting player lists...')
  const allPlayerBasicInfo: { team: Team; players: { id: string; name: string; url: string }[] }[] = []

  for (const team of teams) {
    console.log(`  👥 ${team.name}...`)
    const players = await scrapeTeamPlayerList(team)
    console.log(`      Found ${players.length} players`)
    allPlayerBasicInfo.push({ team, players })
    await new Promise(resolve => setTimeout(resolve, 300))
  }

  const totalPlayers = allPlayerBasicInfo.reduce((sum, t) => sum + t.players.length, 0)
  console.log(`\n📊 Total players to scrape: ${totalPlayers}`)

  // Step 3: Scrape each player's profile page
  console.log('\n🔍 Scraping player profiles (this will take a while)...')
  const allPlayers: Player[] = []
  let playerCount = 0

  for (const { team, players } of allPlayerBasicInfo) {
    console.log(`\n  📁 ${team.name}:`)

    for (const basicInfo of players) {
      playerCount++
      const progress = `[${playerCount}/${totalPlayers}]`
      process.stdout.write(`\r    ${progress} ${basicInfo.name.substring(0, 30).padEnd(30)}`)

      try {
        const player = await scrapePlayerProfile(basicInfo, team)
        allPlayers.push(player)
      } catch (error) {
        console.log(`\n    ⚠️ Error scraping ${basicInfo.name}:`, error)
      }

      // Rate limiting delay
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    console.log() // New line after each team
  }

  console.log(`\n✅ Scraped ${allPlayers.length} player profiles`)

  // Step 4: Download images
  console.log('\n📸 Downloading player images...')
  let downloadedCount = 0
  let failedCount = 0

  for (let i = 0; i < allPlayers.length; i++) {
    const player = allPlayers[i]
    const progress = `${i + 1}/${allPlayers.length}`
    process.stdout.write(`\r  [${progress}] ${player.name.substring(0, 25).padEnd(25)}`)

    const localPath = await downloadPlayerImage(player)
    if (localPath) {
      player.localImagePath = localPath
      downloadedCount++
    } else {
      failedCount++
    }

    await new Promise(resolve => setTimeout(resolve, 100))
  }

  console.log(`\n\n✅ Downloaded ${downloadedCount} images`)
  if (failedCount > 0) {
    console.log(`⚠️ Failed to download ${failedCount} images`)
  }

  // Step 5: Save data
  const outputFile = join(DATA_DIR, 'premier-league.json')
  await writeFile(outputFile, JSON.stringify(allPlayers, null, 2))
  console.log(`\n💾 Player data saved to ${outputFile}`)

  // Save per-team data
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
    const withPosition = players.filter(p => p.position).length
    console.log(`  ${teamSlug}: ${players.length} players (${withImages} images, ${withPosition} with position)`)
  }

  // Print sample player data
  const samplePlayer = allPlayers.find(p => p.position && p.imageUrl)
  if (samplePlayer) {
    console.log('\n📝 Sample player data:')
    console.log(JSON.stringify(samplePlayer, null, 2))
  }

  console.log('\n✨ Scraping complete!')
}

// Run the scraper
main().catch(console.error)
