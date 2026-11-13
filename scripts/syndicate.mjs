#!/usr/bin/env node

/**
 * Syndicate CLI: One-command Blog & X.com Article Syndication Pipeline
 * 
 * Usage:
 *   npm run syndicate [post-slug]
 *   node scripts/syndicate.mjs hello-world
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const BLOG_DIR = path.join(ROOT_DIR, 'src', 'content', 'blog');
const PUBLIC_IMG_DIR = path.join(ROOT_DIR, 'public', 'images');
const SYNDICATE_DIR = path.join(ROOT_DIR, '.syndicate');
const SITE_URL = 'https://michaeldoyle.dev';

// CLI args
const args = process.argv.slice(2);
const flags = {
  noBrowser: args.includes('--no-browser'),
  noStudio: args.includes('--no-studio'),
  forceImage: args.includes('--force-image'),
};
const slugArg = args.find(a => !a.startsWith('--'));

function printHeader() {
  console.log(`\n======================================================`);
  console.log(`🚀 BLOG -> X.COM SYNDICATION PIPELINE`);
  console.log(`======================================================\n`);
}

// 1. Locate the target blog post
function findTargetPost() {
  if (!fs.existsSync(BLOG_DIR)) {
    console.error(`❌ Blog directory not found: ${BLOG_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(BLOG_DIR).filter(f => f.endsWith('.md') || f.endsWith('.mdx'));
  if (files.length === 0) {
    console.error(`❌ No markdown posts found in ${BLOG_DIR}`);
    process.exit(1);
  }

  if (slugArg) {
    const cleanSlug = slugArg.replace(/\.(md|mdx)$/, '').replace(/^.*[\\\/]/, '');
    const matched = files.find(f => f.replace(/\.(md|mdx)$/, '') === cleanSlug);
    if (!matched) {
      console.error(`❌ Could not find post matching slug "${slugArg}". Available posts:`);
      files.forEach(f => console.log(`   - ${f.replace(/\.(md|mdx)$/, '')}`));
      process.exit(1);
    }
    return path.join(BLOG_DIR, matched);
  }

  // If no slug specified, sort by mtime to pick the most recently edited post
  files.sort((a, b) => {
    const statA = fs.statSync(path.join(BLOG_DIR, a));
    const statB = fs.statSync(path.join(BLOG_DIR, b));
    return statB.mtimeMs - statA.mtimeMs;
  });

  const latest = files[0];
  console.log(`ℹ️  No post slug specified. Using most recently updated: "${latest}"`);
  return path.join(BLOG_DIR, latest);
}

// 2. Simple frontmatter parser
function parsePost(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

  if (!match) {
    return {
      rawFrontmatter: '',
      data: {},
      body: content,
      slug: path.basename(filePath, path.extname(filePath)),
      filePath,
    };
  }

  const rawFrontmatter = match[1];
  const body = match[2];
  const data = {};

  rawFrontmatter.split('\n').forEach(line => {
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      let val = line.slice(colonIdx + 1).trim();
      // Remove enclosing quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      data[key] = val;
    }
  });

  const slug = path.basename(filePath, path.extname(filePath));
  return { rawFrontmatter, data, body, slug, filePath };
}

// 3. Inject heroImage into markdown if missing
function ensureHeroImage(post) {
  const { data, slug, filePath } = post;
  const expectedHeroFilename = `${slug}-hero.png`;
  const heroPublicPath = `/images/${expectedHeroFilename}`;
  const diskPath = path.join(PUBLIC_IMG_DIR, expectedHeroFilename);

  let updated = false;

  if (!data.heroImage || flags.forceImage) {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const heroAlt = `${data.title || slug} cover graphic`;

    if (data.heroImage && flags.forceImage) {
      // Overwrite existing heroImage line
      const newContent = fileContent.replace(
        /^heroImage:.*$/m,
        `heroImage: "${heroPublicPath}"\nheroImageAlt: "${heroAlt}"`
      );
      fs.writeFileSync(filePath, newContent, 'utf8');
    } else {
      // Insert into frontmatter
      const newContent = fileContent.replace(
        /^---\r?\n/,
        `---\nheroImage: "${heroPublicPath}"\nheroImageAlt: "${heroAlt}"\n`
      );
      fs.writeFileSync(filePath, newContent, 'utf8');
    }
    console.log(`✅ Updated blog frontmatter: heroImage set to "${heroPublicPath}"`);
    updated = true;
  } else {
    console.log(`📌 Blog post already references hero image: "${data.heroImage}"`);
  }

  const existsOnDisk = fs.existsSync(diskPath);
  return { expectedHeroFilename, diskPath, existsOnDisk, updated };
}

// 4. Markdown to semantic HTML converter for X Article rich text clipboard
function markdownToHtml(md, postUrl) {
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBuffer = [];
  const lines = md.split('\n');
  const output = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks
    if (line.trim().startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = line.trim().slice(3).trim();
        codeBuffer = [];
      } else {
        inCodeBlock = false;
        const escaped = codeBuffer
          .join('\n')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        output.push(`<pre><code>${escaped}</code></pre>`);
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Headings
    if (/^######\s+(.*)/.test(line)) {
      output.push(`<h6>${parseInlines(line.replace(/^######\s+/, ''))}</h6>`);
      continue;
    }
    if (/^#####\s+(.*)/.test(line)) {
      output.push(`<h5>${parseInlines(line.replace(/^#####\s+/, ''))}</h5>`);
      continue;
    }
    if (/^####\s+(.*)/.test(line)) {
      output.push(`<h4>${parseInlines(line.replace(/^####\s+/, ''))}</h4>`);
      continue;
    }
    if (/^###\s+(.*)/.test(line)) {
      output.push(`<h3>${parseInlines(line.replace(/^###\s+/, ''))}</h3>`);
      continue;
    }
    if (/^##\s+(.*)/.test(line)) {
      output.push(`<h2>${parseInlines(line.replace(/^##\s+/, ''))}</h2>`);
      continue;
    }
    if (/^#\s+(.*)/.test(line)) {
      output.push(`<h1>${parseInlines(line.replace(/^#\s+/, ''))}</h1>`);
      continue;
    }

    // Blockquote
    if (/^>\s+(.*)/.test(line)) {
      output.push(`<blockquote><p>${parseInlines(line.replace(/^>\s+/, ''))}</p></blockquote>`);
      continue;
    }

    // Horizontal Rule
    if (/^(\*\*\*|---|___)$/.test(line.trim())) {
      output.push('<hr />');
      continue;
    }

    // Lists (simple unordered)
    if (/^[-*+]\s+(.*)/.test(line)) {
      output.push(`<ul><li>${parseInlines(line.replace(/^[-*+]\s+/, ''))}</li></ul>`);
      continue;
    }

    // Empty lines
    if (line.trim() === '') {
      continue;
    }

    // Normal paragraph
    output.push(`<p>${parseInlines(line)}</p>`);
  }

  // Helper for inline styles
  function parseInlines(str) {
    return str
      // Images: ![alt](url) -> resolve relative URLs
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
        const fullUrl = url.startsWith('/') ? `${SITE_URL}${url}` : url;
        return `<img src="${fullUrl}" alt="${alt}" />`;
      })
      // Links: [text](url) -> resolve relative URLs
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
        const fullUrl = url.startsWith('/') ? `${SITE_URL}${url}` : url;
        return `<a href="${fullUrl}">${text}</a>`;
      })
      // Bold
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/_([^_]+)_/g, '<em>$1</em>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  return output.join('\n');
}

// 5. Copy rich text to macOS clipboard using textutil + pbcopy
function copyRichTextToClipboard(htmlContent) {
  try {
    const wrappedHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.6;">${htmlContent}</body></html>`;
    
    // Pipe HTML through macOS native textutil to convert to RTF, then to pbcopy
    execSync('textutil -convert rtf -stdin -stdout | pbcopy -Prefer rtf', {
      input: wrappedHtml,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return true;
  } catch (err) {
    // Fallback: copy plain text
    try {
      execSync('pbcopy', { input: htmlContent });
      return true;
    } catch {
      return false;
    }
  }
}

// 5b. Extract fenced code blocks to generate Studio Code Card & ray.so links
function extractCodeBlocks(md) {
  const blocks = [];
  const regex = /```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(md)) !== null) {
    const lang = (match[1] || 'typescript').trim().toLowerCase();
    const code = match[2].trim();
    if (code) {
      blocks.push({ lang, code });
    }
  }
  return blocks;
}

// 6. Main Orchestrator
async function run() {
  printHeader();

  const postPath = findTargetPost();
  const post = parsePost(postPath);
  const title = post.data.title || post.slug;
  const description = post.data.description || '';
  const postUrl = `${SITE_URL}/blog/${post.slug}`;

  console.log(`📄 Target Post: "${title}"`);
  console.log(`🔗 Canonical URL: ${postUrl}\n`);

  // Step 1: Ensure Blog Hero Image exists in frontmatter
  const heroInfo = ensureHeroImage(post);

  // Step 2: Prepare syndicated Markdown with Canonical Attribution
  const canonicalCallout = `\n\n---\n*Originally published on [${SITE_URL.replace(/^https?:\/\//, '')}/blog/${post.slug}](${postUrl})*`;
  const syndicatedMd = `# ${title}\n\n${description ? `> ${description}\n\n` : ''}${post.body.trim()}${canonicalCallout}\n`;

  // Step 3: Convert to Rich HTML
  const syndicatedHtml = markdownToHtml(
    `${title ? `# ${title}\n\n` : ''}${description ? `> ${description}\n\n` : ''}${post.body.trim()}${canonicalCallout}`,
    postUrl
  );

  // Step 4: Save Staging files in .syndicate/<slug>/
  const stagingDir = path.join(SYNDICATE_DIR, post.slug);
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.writeFileSync(path.join(stagingDir, 'x-article.md'), syndicatedMd, 'utf8');
  fs.writeFileSync(path.join(stagingDir, 'x-article.html'), syndicatedHtml, 'utf8');
  console.log(`💾 Staged syndicated article files to: .syndicate/${post.slug}/`);

  // Step 5: Copy to macOS Clipboard as Rich Text
  const copied = copyRichTextToClipboard(syndicatedHtml);
  if (copied) {
    console.log(`📋 Copied rich-formatted article to macOS Clipboard! (Headings, bold, links, code blocks preserved)`);
  } else {
    console.log(`⚠️  Could not copy to clipboard automatically. You can copy from: .syndicate/${post.slug}/x-article.md`);
  }

  // Step 6: Launch Banner Studio pre-filled for both Blog Hero & X Article
  if (!flags.noStudio) {
    const studioParams = new URLSearchParams({
      mode: 'banner',
      title: title,
      badge: 'X ARTICLE',
      aspect: '5:2'
    });
    const studioUrl = `http://localhost:3000/?${studioParams.toString()}`;
    console.log(`\n🎨 Banner Studio Link (Pre-filled Cover):`);
    console.log(`   👉 ${studioUrl}`);

    try {
      execSync(`open "${studioUrl}"`);
    } catch {
      // Ignore
    }
  }

  // Step 6b: Generate Code Snapshot links for any fenced code blocks in the post
  const codeBlocks = extractCodeBlocks(post.body);
  if (codeBlocks.length > 0) {
    console.log(`\n💻 Found ${codeBlocks.length} code snippet(s) — Open as Ray.so-style Code Cards:`);
    codeBlocks.forEach((block, idx) => {
      const base64Code = Buffer.from(block.code, 'utf8').toString('base64');
      const extMap = { dart: 'dart', typescript: 'ts', javascript: 'js', python: 'py', bash: 'sh', rust: 'rs', go: 'go', astro: 'astro', json: 'json', swift: 'swift', sql: 'sql' };
      const ext = extMap[block.lang] || block.lang || 'ts';
      const filename = `${post.slug}-${idx + 1}.${ext}`;

      const localCodeParams = new URLSearchParams({
        mode: 'code',
        title: title,
        filename,
        lang: block.lang,
        aspect: 'auto',
        code: base64Code,
      });
      const raySoParams = new URLSearchParams({
        title: filename,
        language: block.lang,
        theme: 'vercel',
        padding: '64',
        background: 'true',
        darkMode: 'true',
        code: base64Code,
      });

      console.log(`   #${idx + 1} [${block.lang}] (${filename}):`);
      console.log(`      • Banner Studio: http://localhost:3000/?${localCodeParams.toString()}`);
      console.log(`      • External ray.so: https://ray.so/#${raySoParams.toString()}`);
    });
  }

  // Step 7: Launch X Article Composer
  if (!flags.noBrowser) {
    console.log(`\n🌐 Opening X.com Article Composer...`);
    try {
      execSync(`open "https://x.com/compose/articles"`);
    } catch {
      // Ignore
    }
  }

  // Step 8: Final Summary Instructions
  console.log(`\n✨ SYNDICATION READY! What to do next:`);
  console.log(`   1. Switch to your browser tab at https://x.com/compose/articles`);
  console.log(`   2. Press Cmd + V inside the article editor (your formatted post is on the clipboard!)`);
  console.log(`   3. In Banner Studio (localhost:3000):`);
  console.log(`      - Click "Download 2x PNG" for X Article (5:2) and drop it in the X header.`);
  console.log(`      - Click "Blog Hero (16:9)" -> "Download 2x PNG" and place it in your blog's public/images/\n`);
}

run();
