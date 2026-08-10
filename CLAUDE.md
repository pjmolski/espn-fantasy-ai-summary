# Project Notes for Claude

## Behavioral Rules

**Don't pivot silently when a user's assertion turns out to be incorrect.**
If the user states something as fact (e.g. "there's a hamburger menu on that page") and investigation shows it's not true, stop and tell them what was actually found before taking any further action. Ask them to confirm how to proceed.

## Project Overview

SvelteKit fantasy football recap app for the Hoboken Diaspora league (ESPN league #615364).
Deployed at: https://espn-fantasy-ai-summary-hoboken.vercel.app
Shell site: /ff/ff/ (served at pjmolski.com/ff/)

## Key Rules

- NEVER run `git commit` or `git push` from bash — creates .git/HEAD.lock files. Only `git add` from bash; give the commit message for the user to run manually.
- Do not call MCP CLI Proxy or investigator-ai-assist-mcp.
