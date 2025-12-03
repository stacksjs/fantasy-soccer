/**
 * Squad data loader - loads player data from JSON files
 * and formats it for the fantasy soccer template
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const DATA_DIR = join(import.meta.dir, '../../data/players')

interface Player {
  id: string
  name: string
  team: string
  teamSlug: string
  position: string
  localImagePath: string
  marketValue: string
  shirtNumber: string
}

interface SquadPlayer {
  id: string
  name: string
  team: string
  points: number
  price: number
  form: string
  isCaptain: boolean
  isVice: boolean
  img: string
  position?: string
}

// Map team names to their JSON file slugs
const teamSlugs: Record<string, string> = {
  'Liverpool': 'liverpool-fc',
  'Arsenal': 'fc-arsenal',
  'Man City': 'manchester-city',
  'Chelsea': 'fc-chelsea',
  'Tottenham': 'tottenham-hotspur',
  'Newcastle': 'newcastle-united',
  'Man United': 'manchester-united',
  'Aston Villa': 'aston-villa',
  'Brighton': 'brighton-amp-hove-albion',
  'West Ham': 'west-ham-united',
  'Crystal Palace': 'crystal-palace',
  'Fulham': 'fc-fulham',
  'Wolves': 'wolverhampton-wanderers',
  'Bournemouth': 'afc-bournemouth',
  'Brentford': 'fc-brentford',
  'Everton': 'fc-everton',
  'Nottingham Forest': 'nottingham-forest',
}

async function loadTeamData(teamSlug: string): Promise<Player[]> {
  const filePath = join(DATA_DIR, `${teamSlug}.json`)
  const content = await readFile(filePath, 'utf-8')
  return JSON.parse(content)
}

function findPlayer(players: Player[], name: string): Player | undefined {
  // Try exact match first
  let player = players.find(p => p.name.toLowerCase() === name.toLowerCase())
  if (player) return player
  
  // Try partial match (last name)
  const lastName = name.split(' ').pop()?.toLowerCase()
  player = players.find(p => p.name.toLowerCase().includes(lastName || ''))
  return player
}

function parseMarketValue(value: string): number {
  // Parse "€28.00m" to 28.0
  const match = value.match(/€?([\d.]+)m?/i)
  return match ? parseFloat(match[1]) : 5.0
}

export async function buildSquadData() {
  // Load all team data
  const teamsData: Record<string, Player[]> = {}
  for (const [teamName, slug] of Object.entries(teamSlugs)) {
    try {
      teamsData[teamName] = await loadTeamData(slug)
    } catch (e) {
      console.warn(`Could not load ${slug}`)
    }
  }

  // Helper to create squad player from real data
  const createSquadPlayer = (
    name: string,
    teamName: string,
    points: number,
    form: string,
    isCaptain = false,
    isVice = false
  ): SquadPlayer => {
    const teamPlayers = teamsData[teamName] || []
    const player = findPlayer(teamPlayers, name)
    
    return {
      id: player?.id || '0',
      name: player?.name || name,
      team: teamName,
      points,
      price: player ? parseMarketValue(player.marketValue) : 5.0,
      form,
      isCaptain,
      isVice,
      img: player?.localImagePath ? `/${player.localImagePath}` : '',
      position: player?.position,
    }
  }

  return {
    goalkeepers: [
      createSquadPlayer('Alisson', 'Liverpool', 72, '6.2'),
    ],
    defenders: [
      createSquadPlayer('Conor Bradley', 'Liverpool', 89, '7.4'),
      createSquadPlayer('Virgil van Dijk', 'Liverpool', 78, '6.8'),
      createSquadPlayer('William Saliba', 'Arsenal', 82, '7.1'),
      createSquadPlayer('Kieran Trippier', 'Newcastle', 95, '7.9'),
    ],
    midfielders: [
      createSquadPlayer('Mohamed Salah', 'Liverpool', 124, '8.8', true, false),
      createSquadPlayer('Bukayo Saka', 'Arsenal', 98, '7.9', false, true),
      createSquadPlayer('Martin Ødegaard', 'Arsenal', 87, '7.2'),
    ],
    forwards: [
      createSquadPlayer('Erling Haaland', 'Man City', 156, '9.2'),
      createSquadPlayer('Ollie Watkins', 'Aston Villa', 92, '7.6'),
      createSquadPlayer('Alexander Isak', 'Liverpool', 88, '7.3'),
    ],
    bench: [
      { ...createSquadPlayer('David Raya', 'Arsenal', 65, '6.0'), position: 'GK' },
      { ...createSquadPlayer('Gabriel', 'Arsenal', 71, '6.5'), position: 'DEF' },
      { ...createSquadPlayer('Alexis Mac Allister', 'Liverpool', 76, '6.8'), position: 'MID' },
      { ...createSquadPlayer('Dominic Solanke', 'Tottenham', 54, '5.5'), position: 'FWD' },
    ],
  }
}

// Run if called directly
if (import.meta.main) {
  const squad = await buildSquadData()
  console.log(JSON.stringify(squad, null, 2))
}
