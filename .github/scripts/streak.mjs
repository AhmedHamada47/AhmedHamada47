// Builds assets/streak.svg from GitHub contribution data.
// Usage: GITHUB_TOKEN=... USERNAME=... node .github/scripts/streak.mjs
import { readFileSync, writeFileSync } from "node:fs";

const token = process.env.GITHUB_TOKEN;
const username = process.env.USERNAME;
if (!token || !username) throw new Error("GITHUB_TOKEN and USERNAME are required");

async function graphql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors ?? json));
  return json.data;
}

const { user } = await graphql(
  `query($login: String!) { user(login: $login) { createdAt } }`,
  { login: username }
);

// Collect every day since the account was created, one calendar year per request.
const days = [];
const firstYear = new Date(user.createdAt).getUTCFullYear();
const thisYear = new Date().getUTCFullYear();
for (let year = firstYear; year <= thisYear; year++) {
  const data = await graphql(
    `query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar { weeks { contributionDays { date contributionCount } } }
        }
      }
    }`,
    { login: username, from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` }
  );
  for (const week of data.user.contributionsCollection.contributionCalendar.weeks)
    for (const day of week.contributionDays) days.push(day);
}

const today = new Date().toISOString().slice(0, 10);
const calendar = [...new Map(days.map(d => [d.date, d.contributionCount])).entries()]
  .filter(([date]) => date <= today)
  .sort(([a], [b]) => a.localeCompare(b));

const total = calendar.reduce((sum, [, count]) => sum + count, 0);
const firstContribution = calendar.find(([, count]) => count > 0)?.[0] ?? today;

// Longest run of consecutive days with at least one contribution.
let longest = { length: 0, start: today, end: today };
let run = { length: 0, start: null };
for (const [date, count] of calendar) {
  if (count > 0) {
    run = run.length ? { length: run.length + 1, start: run.start } : { length: 1, start: date };
    if (run.length > longest.length) longest = { length: run.length, start: run.start, end: date };
  } else {
    run = { length: 0, start: null };
  }
}

// Current streak: ends today, or yesterday if today has no contributions yet.
let i = calendar.length - 1;
if (i >= 0 && calendar[i][1] === 0) i--;
const currentEnd = i >= 0 ? calendar[i][0] : today;
let current = 0;
while (i >= 0 && calendar[i][1] > 0) { current++; i--; }
const currentStart = current ? calendar[i + 1][0] : today;

const fmt = (date, withYear) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
  month: "short", day: "numeric", timeZone: "UTC", ...(withYear ? { year: "numeric" } : {}),
});
const year = date => Number(date.slice(0, 4));
const range = (start, end) => {
  if (start === end) return fmt(start, year(start) !== thisYear);
  const withYear = year(start) !== thisYear || year(end) !== thisYear;
  return `${fmt(start, withYear)} - ${fmt(end, withYear)}`;
};

const values = {
  TOTAL: total.toLocaleString("en-US"),
  TOTAL_RANGE: `${fmt(firstContribution, true)} - Present`,
  CURRENT: String(current),
  CURRENT_RANGE: current ? range(currentStart, currentEnd) : fmt(today, false),
  LONGEST: String(longest.length),
  LONGEST_RANGE: longest.length ? range(longest.start, longest.end) : "-",
};

// One card per GitHub theme; the README picks between them with <picture>.
const themes = {
  dark: { BG: "#151515", BORDER: "#E4E2E2", TEXT: "#FEFEFE", MUTED: "#9E9E9E", ACCENT: "#58A6FF", RING: "#1F6FEB" },
  light: { BG: "#FFFFFF", BORDER: "#D0D7DE", TEXT: "#1F2328", MUTED: "#59636E", ACCENT: "#0969DA", RING: "#0969DA" },
};

const template = readFileSync(new URL("./streak-template.svg", import.meta.url), "utf8");
for (const [name, colors] of Object.entries(themes)) {
  const svg = template.replace(/\{\{(\w+)\}\}/g, (_, key) => ({ ...values, ...colors })[key]);
  writeFileSync(`assets/streak-${name}.svg`, svg);
}
console.log(values);
