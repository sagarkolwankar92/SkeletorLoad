# Skeleton Loader Creator

A tiny static web app that turns image, SVG, or first-page PDF layouts into animated skeleton loader placeholders.

## Features

- Upload PNG, JPG, WebP, SVG, or PDF files.
- Show upload progress, uploaded filename, and one-click file removal.
- Compare the uploaded image with the generated skeleton loader in stacked preview panes.
- Detect visual blocks from the source preview.
- Tune sensitivity, loader box count, corner radius, color hue mapping, and target GIF size.
- Export as animated GIF or Lottie JSON.
- Deploys directly to GitHub Pages.

## Run locally

Open `index.html` in a browser.

PDF support uses PDF.js from a CDN, so it needs an internet connection when loading PDF files. Image, SVG, GIF export, and Lottie export work without a build step.

## Publish on GitHub Pages

1. Create a new GitHub repository.
2. Push these files to the repository.
3. In GitHub, open `Settings -> Pages`.
4. Set `Source` to `Deploy from a branch`.
5. Choose the `main` branch and `/root`, then save.

Your app will be available at the GitHub Pages URL shown in that settings page.

## Notes

This app estimates skeleton regions by finding connected non-white areas in a rendered canvas. It is best for wireframes, clean screenshots, simple PDFs, dashboards, cards, forms, and product layouts.
