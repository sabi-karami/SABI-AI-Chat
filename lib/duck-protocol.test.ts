import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveModel,
  extractFeVersion,
  decodeChallengeHeader,
  buildProof,
  sha256B64,
  formatFileToPromptChunk,
  buildChatRequestBody,
  parseSseLine,
  parseSlashCommand,
  buildCliCommandPreview,
  isImageGenerationPrompt,
  resolveImageDimensions,
  buildEnhancedDrawPrompt,
  rebuildHistoryFromMessages,
  extractImageGenPrompt,
} from './duck-protocol';

test('resolveModel maps short aliases and full names accurately', () => {
  assert.equal(resolveModel('luna'), 'gpt-6-luna');
  assert.equal(resolveModel('mini'), 'gpt-5.4-mini');
  assert.equal(resolveModel('nano'), 'gpt-5.4-nano');
  assert.equal(resolveModel('haiku'), 'claude-haiku-4-5');
  assert.equal(resolveModel('mistral'), 'mistral-small-2603');
  assert.equal(resolveModel('gpt-5.6-luna'), 'gpt-5.6-luna');
  assert.equal(resolveModel(null), 'gpt-6-luna');
});

test('extractFeVersion extracts version tag and sha from duck.ai HTML', () => {
  const html = '<html data-version-tag="2026.11.03" data-version-sha="a1b2c3d"><head></head></html>';
  assert.equal(extractFeVersion(html), '2026.11.03-a1b2c3d');
  assert.equal(extractFeVersion('<html></html>'), 'dev-hash');
});

test('decodeChallengeHeader handles unpadded base64 strings', () => {
  const rawJs = '(function(){ return { client_hashes: ["abc"] }; })()';
  const b64NoPad = Buffer.from(rawJs, 'utf-8').toString('base64').replace(/=+$/, '');
  assert.equal(decodeChallengeHeader(b64NoPad), rawJs);
});

test('buildProof hashes client_hashes with sha256 base64 and sets meta stack', () => {
  const solved = {
    server_hashes: ['srv1', 'srv2'],
    client_hashes: ['raw_client_1'],
    signals: { a: 1 },
    meta: { v: '1' },
  };
  const proofB64 = buildProof(solved);
  const decoded = JSON.parse(Buffer.from(proofB64, 'base64').toString('utf-8'));
  assert.deepEqual(decoded.server_hashes, ['srv1', 'srv2']);
  assert.deepEqual(decoded.client_hashes, [sha256B64('raw_client_1')]);
  assert.equal(decoded.meta.origin, 'https://duck.ai');
  assert.equal(decoded.meta.duration, '58');
  assert.ok(decoded.meta.stack.includes('entry.duckai.js'));
});

test('formatFileToPromptChunk formats code blocks and truncates long files', () => {
  const chunk = formatFileToPromptChunk('main.py', 'print("hello")');
  assert.ok(chunk.includes('محتوای فایل «main.py»:'));
  assert.ok(chunk.includes('```py\nprint("hello")\n```'));

  const longChunk = formatFileToPromptChunk('notes.txt', 'a'.repeat(100), 20);
  assert.ok(longChunk.includes('[… فایل طولانی بود و به 20 کاراکتر برش خورد]'));
});

test('buildChatRequestBody orders text before WebP images and sets GenerateImage toolChoice when draw=true', () => {
  const img = {
    type: 'image' as const,
    mimeType: 'image/webp' as const,
    image: 'data:image/webp;base64,UklGRg==',
  };
  const body = buildChatRequestBody({
    prompt: 'این تصویر چیست؟',
    model: 'mini',
    images: [img],
    draw: false,
    promptExtra: '\nextra',
  });
  assert.equal(body.model, 'gpt-5.4-mini');
  assert.equal(body.metadata, undefined);
  const messages = body.messages as any[];
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content[0].type, 'text');
  assert.equal(messages[0].content[0].text, 'این تصویر چیست؟\nextra');
  assert.equal(messages[0].content[1].type, 'image');
  assert.equal(messages[0].content[1].mimeType, 'image/webp');

  const drawBody = buildChatRequestBody({
    prompt: 'یک گربه نارنجی',
    model: 'luna',
    draw: true,
  });
  assert.deepEqual(drawBody.metadata, { toolChoice: { GenerateImage: true } });
});

test('parseSseLine parses message, image generation events, tool invocations, and ignores [DONE]', () => {
  assert.equal(parseSseLine('data: [DONE]'), null);
  assert.equal(parseSseLine('data: [PING]'), null);

  const msgEv = parseSseLine('data: {"message":"سلام دنیا"}');
  assert.deepEqual(msgEv, { kind: 'message', value: 'سلام دنیا' });

  const titleEv = parseSseLine(
    'data: {"role":"ui-component","name":"generate-image","data":{"type":"image-title","title":"Drawing cat..."}}'
  );
  assert.deepEqual(titleEv, { kind: 'image_title', value: 'Drawing cat...' });

  const imgEv = parseSseLine(
    'data: {"role":"ui-component","name":"generate-image","data":{"status":"success","b64Image":"ABCD","width":1024,"height":1024,"format":"jpeg"}}'
  );
  assert.deepEqual(imgEv, {
    kind: 'image',
    value: { b64: 'ABCD', width: 1024, height: 1024, format: 'jpeg' },
  });

  const toolEv = parseSseLine(
    'data: {"role":"tool-invocation","toolName":"GenerateImage","state":"call","toolArguments":{"prompt":"cat"}}'
  );
  assert.equal(toolEv?.kind, 'tool');
});

test('parseSlashCommand recognizes all CLI slash commands', () => {
  assert.deepEqual(parseSlashCommand('/draw یک آسمان پرستاره'), {
    type: 'draw',
    prompt: 'یک آسمان پرستاره',
  });
  assert.deepEqual(parseSlashCommand('/model haiku'), {
    type: 'model',
    arg: 'haiku',
  });
  assert.deepEqual(parseSlashCommand('/clear'), { type: 'clear' });
  assert.deepEqual(parseSlashCommand('/live'), { type: 'live' });
  assert.deepEqual(parseSlashCommand('/mic'), { type: 'mic' });
  assert.deepEqual(parseSlashCommand('سلام'), { type: 'none' });
});

test('buildCliCommandPreview generates valid duck_cli.py invocation', () => {
  const cmd = buildCliCommandPreview({
    prompt: 'این چیه؟',
    model: 'gpt-5.4-mini',
    imageNames: ['photo.jpg'],
  });
  assert.equal(
    cmd,
    'python duck_cli.py --ask "این چیه؟" --image "photo.jpg" --model gpt-5.4-mini'
  );
});

test('isImageGenerationPrompt detects Persian and English draw prompts accurately', () => {
  assert.equal(isImageGenerationPrompt('عکس یک دختر خوشگل ایرانی طراحی کن'), true);
  assert.equal(isImageGenerationPrompt('یک تصویر از کوهستان برفی بساز'), true);
  assert.equal(isImageGenerationPrompt('draw a futuristic city photo'), true);
  assert.equal(isImageGenerationPrompt('سلام حالت چطوره؟'), false);
  assert.equal(isImageGenerationPrompt('این عکس در مورد چیست؟'), false);
});

test('resolveImageDimensions returns accurate pixel dimensions for 1K, 2K, and 4K tiers', () => {
  assert.deepEqual(resolveImageDimensions('1K', '1:1'), { width: 1024, height: 1024 });
  assert.deepEqual(resolveImageDimensions('2K', '16:9'), { width: 2560, height: 1440 });
  assert.deepEqual(resolveImageDimensions('4K', '16:9'), { width: 3840, height: 2160 });
  assert.deepEqual(resolveImageDimensions('4K', '9:16'), { width: 2160, height: 3840 });
  assert.deepEqual(resolveImageDimensions('4K', '1:1'), { width: 3840, height: 3840 });
});

test('buildEnhancedDrawPrompt appends quality and aspect ratio specifications', () => {
  const enhanced = buildEnhancedDrawPrompt('یک منظره کوهستانی', '4K', '16:9');
  assert.ok(enhanced.includes('یک منظره کوهستانی'));
  assert.ok(enhanced.includes('4K UHD'));
  assert.ok(enhanced.includes('16:9 wide horizontal'));
});

test('rebuildHistoryFromMessages reconstructs user and assistant history accurately after message edit', () => {
  const history = rebuildHistoryFromMessages([
    {
      role: 'user',
      text: 'سلام، اسم من علی است',
      files: [{ name: 'note.txt', content: 'یادداشت اول' }],
    },
    {
      role: 'assistant',
      text: 'سلام علی جان! خوشبختم.',
    },
  ]);

  assert.equal(history.length, 2);
  assert.equal(history[0].role, 'user');
  assert.ok(Array.isArray(history[0].content));
  assert.ok((history[0].content[0] as any).text.includes('سلام، اسم من علی است'));
  assert.ok((history[0].content[0] as any).text.includes('note.txt'));
  assert.equal(history[1].role, 'assistant');
  assert.equal(history[1].content, 'سلام علی جان! خوشبختم.');
});

test('extractImageGenPrompt extracts imageGenPrompt from JSON string or object toolArguments', () => {
  const rawJson =
    '{"imageGenPrompt":"A single ripe red apple resting on a wooden table","imageToUse":"none"}';
  assert.equal(
    extractImageGenPrompt(rawJson),
    'A single ripe red apple resting on a wooden table'
  );
  assert.equal(
    extractImageGenPrompt({ prompt: 'A futuristic neon city at night' }),
    'A futuristic neon city at night'
  );
  assert.equal(extractImageGenPrompt(null), null);
});
