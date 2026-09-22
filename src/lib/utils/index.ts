function getNFLWeek(): number {
	const today = new Date();
	const kickoff = new Date(2026, 8, 4); // Note: month is 0-indexed in JavaScript
	const daysSinceKickoff = Math.floor(
		(today.getTime() - kickoff.getTime()) / (1000 * 60 * 60 * 24)
	);
	const weeksSinceKickoff = Math.floor(daysSinceKickoff / 7);
	const dayOfWeek = today.getDay();
	const isTuesdayOrLater = dayOfWeek > 2 || (dayOfWeek === 2 && today.getHours() >= 0);
	return weeksSinceKickoff + (isTuesdayOrLater ? 1 : 0);
}

function getNFLSeason(): number {
	const today = new Date();
	return today.getMonth() < 7 ? today.getFullYear() - 1 : today.getFullYear();
}

export { getNFLWeek, getNFLSeason };
