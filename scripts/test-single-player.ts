#!/usr/bin/env bun
/**
 * Test scraping a single player profile - using same logic as main scraper
 */

import { createScraper } from 'ts-web-scraper'

const BASE_URL = 'https://www.transfermarkt.com'

const scraper = createScraper({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  retry: {
    maxRetries: 3,
    initialDelay: 2000,
  },
})

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

async function scrapePlayer(url: string) {
  console.log('Scraping:', url)

  const result = await scraper.scrape(url, {
    extract: (doc) => {
      // Get header image - prefer header size
      let imageUrl: string | null = null
      const allImages = doc.querySelectorAll('img')
      for (const img of allImages) {
        const src = img.getAttribute('data-src') || img.getAttribute('src')
        if (src && src.includes('portrait')) {
          imageUrl = src.replace('/small/', '/header/').replace('/medium/', '/header/').replace('/big/', '/header/')
          break
        }
      }

      // Get player name with shirt number
      const nameEl = doc.querySelector('h1.data-header__headline-wrapper')
      const fullName = cleanText(nameEl?.textContent)

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

      // Position
      let position: string | null = null
      const posPatterns = [
        /Position:\s*(?:Attack\s*-\s*|Midfield\s*-\s*|Defender\s*-\s*)?([A-Za-z\-\s]+?)(?:\s+Foot|\s+Agent|\s+Player|\s+National|$)/im,
        /Main position:\s*([A-Za-z\-\s]+)/im,
      ]
      for (const pattern of posPatterns) {
        const match = bodyText.match(pattern)
        if (match) {
          position = cleanText(match[1]).replace(/\s*(National|Player|agent).*$/i, '').trim()
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
        shirtNumber,
        imageUrl,
        marketValue,
        dateOfBirth,
        age,
        placeOfBirth,
        citizenship,
        height,
        position,
        foot,
        agent,
        joined,
        contractExpires,
        currentClub,
        internationalTeam,
        internationalCaps,
        internationalGoals,
      }
    },
  })

  return result.data
}

async function main() {
  // Test with Viktor Gyökeres
  const player = await scrapePlayer('https://www.transfermarkt.com/viktor-gyokeres/profil/spieler/325443')
  console.log('\n=== Viktor Gyökeres ===')
  console.log(JSON.stringify(player, null, 2))

  // Test with Mohamed Salah
  console.log('\n\nScraping second player...')
  const player2 = await scrapePlayer('https://www.transfermarkt.com/mohamed-salah/profil/spieler/148455')
  console.log('\n=== Mohamed Salah ===')
  console.log(JSON.stringify(player2, null, 2))

  // Test with Erling Haaland
  console.log('\n\nScraping third player...')
  const player3 = await scrapePlayer('https://www.transfermarkt.com/erling-haaland/profil/spieler/418560')
  console.log('\n=== Erling Haaland ===')
  console.log(JSON.stringify(player3, null, 2))
}

main().catch(console.error)
