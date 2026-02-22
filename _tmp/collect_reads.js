const fs = require('fs');
const path = require('path');

const transcriptPath = path.join('C:', 'Users', 'Math', '.claude', 'projects', 'c--Users-Math-Documents-Bataille', 'e7fdd3a8-2cd1-4327-9ffa-029ab904193b.jsonl');
const tlines = fs.readFileSync(transcriptPath, 'utf-8').split('\n');

// Collect all Read tool calls for game-animations.js and their results
const reads = [];
for (let i = 0; i < tlines.length; i++) {
  if (!tlines[i].trim()) continue;
  try {
    const obj = JSON.parse(tlines[i]);
    if (obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
      for (const block of obj.message.content) {
        if (block.type === 'tool_use' && block.name === 'Read' && block.input && String(block.input.file_path || '').includes('game-animations')) {
          reads.push({
            transcriptLine: i + 1,
            id: block.id,
            offset: block.input.offset || 1,
            limit: block.input.limit || 99999,
          });
        }
      }
    }
  } catch (e) { }
}

// Now find tool results for each read
for (const read of reads) {
  for (let i = read.transcriptLine; i < Math.min(tlines.length, read.transcriptLine + 5); i++) {
    if (!tlines[i].trim()) continue;
    try {
      const obj = JSON.parse(tlines[i]);
      if (obj.type === 'user' && obj.message && Array.isArray(obj.message.content)) {
        for (const block of obj.message.content) {
          if (block.type === 'tool_result' && block.tool_use_id === read.id) {
            const content = typeof block.content === 'string' ? block.content : '';
            // Parse the content to extract line numbers
            const contentLines = content.split('\n');
            let firstLine = null, lastLine = null;
            for (const cl of contentLines) {
              const m = cl.match(/^\s*(\d+)[→|]/);
              if (m) {
                const ln = parseInt(m[1]);
                if (firstLine === null) firstLine = ln;
                lastLine = ln;
              }
            }
            read.firstLine = firstLine;
            read.lastLine = lastLine;
            read.contentLength = content.length;
            read.rawContent = content;
          }
        }
      }
    } catch (e) { }
  }
}

console.log('Reads found: ' + reads.length);
for (const r of reads) {
  console.log('  Line ' + r.transcriptLine + ': offset=' + r.offset + ' limit=' + r.limit + ' -> lines ' + r.firstLine + '-' + r.lastLine + ' (' + r.contentLength + ' chars)');
}

// Determine coverage
const covered = new Set();
for (const r of reads) {
  if (r.firstLine && r.lastLine) {
    for (let l = r.firstLine; l <= r.lastLine; l++) {
      covered.add(l);
    }
  }
}
const sortedCovered = [...covered].sort((a, b) => a - b);
console.log('\nTotal unique lines covered: ' + covered.size);
if (sortedCovered.length > 0) {
  console.log('Range: ' + sortedCovered[0] + ' to ' + sortedCovered[sortedCovered.length - 1]);
  // Find gaps
  let gaps = [];
  for (let i = 1; i < sortedCovered.length; i++) {
    if (sortedCovered[i] - sortedCovered[i-1] > 1) {
      gaps.push([sortedCovered[i-1] + 1, sortedCovered[i] - 1]);
    }
  }
  if (gaps.length > 0) {
    console.log('Gaps: ' + gaps.map(g => g[0] + '-' + g[1]).join(', '));
  }
}

// Save reads data
fs.writeFileSync(path.join('C:', 'Users', 'Math', 'Documents', 'Bataille', '_tmp', 'reads_data.json'), JSON.stringify(reads.map(r => ({
  transcriptLine: r.transcriptLine,
  offset: r.offset,
  limit: r.limit,
  firstLine: r.firstLine,
  lastLine: r.lastLine,
  rawContent: r.rawContent
})), null, 2));
