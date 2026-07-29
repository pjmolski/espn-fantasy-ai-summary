// ─── Season-level data (one doc per league + season) ────────────────────────

export interface ScoringItem {
	statId: number;
	points: number;
}

export interface SeasonTeam {
	teamId: number;
	name: string; // location + nickname for that season
	abbreviation: string;
	owners: string[]; // resolved display names from ESPN members array
	logoUrl?: string;
}

export interface DraftPick {
	round: number;
	roundPick: number;
	overallPick: number;
	teamId: number;
	playerId: number;
	isKeeper: boolean;
}

export interface SeasonDoc {
	leagueId: string;
	seasonId: number;
	leagueName: string;
	teamCount: number;
	settings: {
		scoringType: string;
		scoringItems: ScoringItem[];
		lineupSlotCounts: Record<string, number>;
		playoffTeamCount: number;
		regularSeasonWeeks: number;
		acquisitionBudget: number;
	};
	teams: SeasonTeam[];
	draft: {
		type: string;
		date?: number; // epoch ms
		picks: DraftPick[];
	};
	capturedAt: Date;
}

// ─── Weekly matchup data (one doc per league + season + week) ────────────────

export interface PlayerEntry {
	playerId: number;
	fullName: string;
	defaultPositionId: number; // 1=QB 2=RB 3=WR 4=TE 5=K 16=D/ST
	lineupSlotId: number; // 0=QB 2=RB 4=WR 6=TE 16=D/ST 17=K 23=FLEX 20=Bench 21=IR
	isStarter: boolean;
	actualScore: number;
	projectedScore: number;
	projectedCeiling: number;
	proTeamId: number; // ESPN NFL team ID (0 = free agent/D/ST)
	injuryStatus: string; // "ACTIVE" | "QUESTIONABLE" | "OUT" | "DOUBTFUL"
	acquisitionType: string; // "DRAFT" | "FREEAGENT" | "WAIVERS"
	acquisitionDate?: number; // epoch ms
	appliedStats: Record<string, number>; // statId → fantasy points earned
}

export interface TeamMatchupData {
	teamId: number;
	totalPoints: number;
	roster: PlayerEntry[];
}

export interface MatchupEntry {
	matchupId: number;
	matchupPeriodId: number;
	winner: string; // "HOME" | "AWAY" | "UNDECIDED" | "TIE"
	playoffTierType: string; // "NONE" | "WINNERS_BRACKET" | "LOSERS_CONSOLATION_LADDER" etc.
	home: TeamMatchupData;
	away?: TeamMatchupData; // undefined for playoff byes
}

export interface WeeklyMatchupDoc {
	leagueId: string;
	seasonId: number;
	scoringPeriodId: number;
	isPlayoff: boolean;
	capturedAt: Date;
	matchups: MatchupEntry[];
}
