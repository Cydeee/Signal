# .github/workflows/scrape-liquidation.yml

name: Scrape CoinGlass Liquidations

# allow the runner to commit & push changes
permissions:
  contents: write

on:
  push:
    branches:
      - main
  schedule:
    - cron: '*/15 * * * *'
  workflow_dispatch:

jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v3
        with:
          # this ensures the GITHUB_TOKEN is used for pushing
          persist-credentials: true

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm install

      - name: Run scraper
        run: npm run scrape:liquidation

      - name: Commit & push if changed
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add liquidation.json
          git diff --quiet --cached || git commit -m "chore: update liquidation.json"
          git push
