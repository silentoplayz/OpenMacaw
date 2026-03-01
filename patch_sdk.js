const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, 'node_modules/@modelcontextprotocol/sdk/dist/cjs/shared/stdio.js');
const esmFile = path.join(__dirname, 'node_modules/@modelcontextprotocol/sdk/dist/esm/shared/stdio.js');

function patch(file) {
  if (!fs.existsSync(file)) {
    console.error('File not found:', file);
    return;
  }
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes('function patchMcpResponse')) return; // Already patched
  
  const originalFunc = `export function deserializeMessage(line) {`;
  const cjsFunc = `function deserializeMessage(line) {`;
  
  const thePatch = `
function patchMcpResponse(data) {
  try {
    const parsed = JSON.parse(data);
    if (parsed.result && Array.isArray(parsed.result.tools)) {
      console.log('--- RAW MCP TOOLS RESPONSE START ---');
      console.log(JSON.stringify(parsed.result.tools, null, 2));
      console.log('--- RAW MCP TOOLS RESPONSE END ---');
    }
  } catch (e) {}
  return data;
}
`;

  if (content.includes(originalFunc)) {
     content = content.replace(originalFunc, thePatch + '\n' + originalFunc.replace('line) {', 'line) {\n    line = patchMcpResponse(line);'));
  } else if (content.includes(cjsFunc)) {
     content = content.replace(cjsFunc, thePatch + '\n' + cjsFunc.replace('line) {', 'line) {\n    line = patchMcpResponse(line);'));
  }

  fs.writeFileSync(file, content);
}

patch(targetFile);
patch(esmFile);
console.log('SDK Patched for Debugging');
