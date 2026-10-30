# michaeldoyle.dev

A personal website/blog.

Built with [Astro](https://astro.build) and [Tailwind CSS](https://tailwindcss.com), deployed to GitHub Pages via GitHub Actions.

## 🛠️ Local Development

Ensure you have Node 22+ and [pnpm](https://pnpm.io) installed:

```bash
# Install dependencies
pnpm install

# Start local development server (http://localhost:4321)
pnpm dev

# Build production static bundle (dist/)
pnpm build

# Preview production build locally
pnpm preview
```

## ✍️ Adding Content

### New Blog Post

Create a new `.md` or `.mdx` file in `src/content/blog/`:

```markdown
---
title: "Your Post Title"
description: "A short summary of your post."
pubDate: 2026-10-30
tags: ["tech", "learning"]
---

Your content here...
```

### New Project

Create a new `.md` file in `src/content/projects/`:

```markdown
---
title: "Project Name"
description: "What the project does."
tags: ["TypeScript", "React"]
github: "https://github.com/MichaelDoyle/repo"
link: "https://project-demo.com"
featured: true
order: 1
---
```

## 🌐 Custom Domain

The site is configured for custom domain `michaeldoyle.dev` via `public/CNAME`.
