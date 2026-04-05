cat > CLAUDE.md << 'EOF'
# Project Instructions for Claude

## What this project is
CHEMLOG - a multi-page HTML/CSS/JS website.

## File structure
- index.html — main entry point
- style.css — global styles
- chem/ — chemistry log pages
- editor/ — editor interface
- main/ — main section pages
- training/ — training section
- images/ — image assets

## Repair loop rules
- Check all HTML, CSS, and JavaScript files for errors
- Fix broken HTML tags, invalid CSS, and JavaScript bugs
- Never delete content, only fix errors
- Never modify image files or firebase.js unless specifically asked
- After fixing, explain what was wrong in plain English
- If unsure about a fix, ask before changing anything
EOF