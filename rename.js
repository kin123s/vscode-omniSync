const fs = require('fs');
const path = require('path');

const projectRoot = 'd:/projects/prj_jira_extension/vscode-omniSync';

const replaceMap = {
  'universalAgent': 'orx',
  'universal-agent': 'orx',
  'vscode-omnisync': 'vscode-orx',
  'Universal Agent': 'Orx'
};

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let newContent = content;

  for (const [key, value] of Object.entries(replaceMap)) {
    // Escape regex characters just in case, though these are simple strings
    const regex = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    newContent = newContent.replace(regex, value);
  }

  if (content !== newContent) {
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log(`Updated: ${filePath}`);
  }
}

function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walkDir(fullPath);
    } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.json') || fullPath.endsWith('.js')) {
      processFile(fullPath);
    }
  }
}

// Process package.json
processFile(path.join(projectRoot, 'package.json'));

// Process src directory
walkDir(path.join(projectRoot, 'src'));

console.log('Done.');
