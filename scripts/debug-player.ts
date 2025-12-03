#!/usr/bin/env bun
/**
 * Debug script to examine player profile page structure
 */

import { createScraper } from 'ts-web-scraper'

const BASE_URL = 'https://www.transfermarkt.com'
// Viktor Gyökeres profile
const PLAYER_URL = `${BASE_URL}/viktor-gyokeres/profil/spieler/325443`

const scraper = createScraper({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  retry: {
    maxRetries: 3,
    initialDelay: 2000,
  },
})

async function main() {
  console.log('Fetching player profile:', PLAYER_URL)

  const result = await scraper.scrape(PLAYER_URL, {
    extract: (doc) => {
      // Look for player image
      const images: { src: string | null, class: string | null }[] = []
      const allImages = doc.querySelectorAll('img')
      for (const img of allImages) {
        const src = img.getAttribute('data-src') || img.getAttribute('src')
        const className = img.getAttribute('class')
        if (src && (src.includes('portrait') || src.includes('spieler') || src.includes('header'))) {
          images.push({ src, class: className })
        }
      }

      // Look for data in the info table
      const infoItems: { label: string, value: string }[] = []

      // Try various selectors for info sections
      const selectors = [
        '.info-table .info-table__content',
        '.spielerdaten .zeile-formular',
        '[class*="info"] span',
        '.data-header__items',
        '.data-header__label',
        '.data-header__content',
      ]

      for (const selector of selectors) {
        const elements = doc.querySelectorAll(selector)
        if (elements.length > 0) {
          console.log(`\n${selector}: ${elements.length} elements`)
          elements.slice(0, 5).forEach(el => {
            console.log('  Text:', el.textContent?.trim().substring(0, 100))
          })
        }
      }

      // Get all text that might contain player info
      const spans = doc.querySelectorAll('span')
      const playerInfo: string[] = []
      for (const span of spans) {
        const text = span.textContent?.trim()
        if (text && (
          text.includes('Date of birth') ||
          text.includes('Height') ||
          text.includes('Position') ||
          text.includes('Citizenship') ||
          text.includes('Place of birth') ||
          text.includes('Foot') ||
          text.includes('Current club') ||
          text.includes('Market value')
        )) {
          playerInfo.push(text)
        }
      }

      // Get header image specifically
      const headerImg = doc.querySelector('.data-header__profile-image')
      const headerImgSrc = headerImg?.getAttribute('src') || headerImg?.getAttribute('data-src')

      // Try to find the player name
      const nameEl = doc.querySelector('h1.data-header__headline-wrapper')
      const name = nameEl?.textContent?.trim()

      // Get body content sample
      const body = doc.querySelector('body')
      const bodyText = body?.textContent?.substring(0, 2000)

      return {
        name,
        headerImage: headerImgSrc,
        images,
        playerInfo,
        bodyTextSample: bodyText,
      }
    },
  })

  console.log('\n\n=== Results ===')
  console.log('Name:', result.data.name)
  console.log('\nHeader Image:', result.data.headerImage)
  console.log('\nImages found:', result.data.images.length)
  result.data.images.slice(0, 5).forEach(img => {
    console.log('  -', img.src?.substring(0, 100))
  })
  console.log('\nPlayer info strings:', result.data.playerInfo.length)
  result.data.playerInfo.forEach(info => {
    console.log('  -', info.substring(0, 150))
  })
  console.log('\n\nBody text sample:')
  console.log(result.data.bodyTextSample)
}

main().catch(console.error)
