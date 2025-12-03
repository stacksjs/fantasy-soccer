#!/usr/bin/env bun
/**
 * Debug script to see what HTML we're getting from Transfermarkt
 */

import { createScraper } from 'ts-web-scraper'

const BASE_URL = 'https://www.transfermarkt.com'
const PREMIER_LEAGUE_URL = `${BASE_URL}/premier-league/startseite/wettbewerb/GB1`

const scraper = createScraper({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  retry: {
    maxRetries: 3,
    initialDelay: 2000,
  },
})

async function main() {
  console.log('Fetching:', PREMIER_LEAGUE_URL)

  const result = await scraper.scrape(PREMIER_LEAGUE_URL, {
    extract: (doc) => {
      // Get all tables
      const tables = doc.querySelectorAll('table')
      console.log('Found tables:', tables.length)

      // Look for team links - try various selectors
      const selectors = [
        '#yw1 .items tbody tr',
        '.items tbody tr',
        'table.items tr',
        '.responsive-table tbody tr',
        '[class*="table"] tbody tr',
        'a[href*="/verein/"]',
        'a[href*="/startseite/verein/"]',
        '.vereinsinfo a',
        '.tm-team a',
        '.club-name a',
        '.data-header__club a',
      ]

      const results: Record<string, number> = {}

      for (const selector of selectors) {
        const elements = doc.querySelectorAll(selector)
        results[selector] = elements.length
        if (elements.length > 0) {
          console.log(`\n${selector}: ${elements.length} elements`)
          // Show first element's content
          const first = elements[0]
          if (first) {
            console.log('  First element text:', first.textContent?.substring(0, 100))
            const links = first.querySelectorAll('a')
            if (links.length > 0) {
              console.log('  First link href:', links[0]?.getAttribute('href'))
              console.log('  First link text:', links[0]?.textContent?.trim())
            }
          }
        }
      }

      // Try to get any links with "verein" in href
      const allLinks = doc.querySelectorAll('a')
      const vereinLinks = allLinks.filter(a => {
        const href = a.getAttribute('href')
        return href?.includes('/verein/')
      })
      console.log(`\nLinks containing '/verein/': ${vereinLinks.length}`)
      if (vereinLinks.length > 0) {
        console.log('Sample verein links:')
        vereinLinks.slice(0, 5).forEach(link => {
          console.log(`  ${link.textContent?.trim()} -> ${link.getAttribute('href')}`)
        })
      }

      // Get body content sample
      const body = doc.querySelector('body')
      const bodyText = body?.textContent?.substring(0, 500)
      console.log('\nBody text sample:', bodyText)

      return results
    },
  })

  console.log('\n\nFinal results:', result.data)
}

main().catch(console.error)
