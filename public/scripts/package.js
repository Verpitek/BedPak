const API_URL = "";
let packageData = null;
let currentUserId = null;

// Configure marked for secure markdown rendering with lazy loading
if (typeof marked !== "undefined") {
  // Create custom image renderer to add lazy loading
  const renderer = new marked.Renderer();
  const originalImageRenderer = renderer.image.bind(renderer);
  
  renderer.image = function(token) {
    const html = originalImageRenderer(token);
    // Add loading="lazy" to the image tag
    return html.replace(/<img\s/, '<img loading="lazy" ');
  };

  marked.setOptions({
    breaks: true,
    gfm: true,
    renderer: renderer,
    highlight: function (code, lang) {
      if (typeof hljs !== "undefined" && lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { language: lang }).value;
        } catch (e) {}
      }
      return code;
    },
  });
}

// Get package name from URL
function getPackageNameFromURL() {
  const path = window.location.pathname;
  const match = path.match(/^\/package\/(.+)$/);
  if (match) {
    return decodeURIComponent(match[1]);
  }
  return null;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Sanitize markdown to prevent XSS
function sanitizeMarkdown(markdown) {
  let sanitized = markdown
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+\s*=/gi, "");
  return sanitized;
}

// Format date
function formatDate(dateStr) {
  if (!dateStr) return "Unknown";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Format download count
function formatDownloads(count) {
  if (!count) return "0";
  if (count >= 1000000) {
    return (count / 1000000).toFixed(1) + "M";
  }
  if (count >= 1000) {
    return (count / 1000).toFixed(1) + "K";
  }
  return count.toString();
}

// Extract YouTube video ID
function getYouTubeVideoId(url) {
  if (!url) return null;
  const match = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/,
  );
  return match ? match[1] : null;
}

// Update meta tags
function updateMetaTags(pkg) {
  document.title = `${pkg.name} - BedPak`;

  const setMeta = (selector, content) => {
    const el = document.querySelector(selector);
    if (el) el.content = content;
  };

  const desc = pkg.description || "Minecraft Bedrock addon";
  const imgUrl = pkg.icon_url || "/logos/bedpak.svg";

  setMeta('meta[name="description"]', desc);
  setMeta('meta[property="og:title"]', `${pkg.name} - Minecraft Bedrock Addon`);
  setMeta('meta[property="og:description"]', desc);
  setMeta('meta[property="og:image"]', imgUrl);
  setMeta('meta[property="og:url"]', window.location.href);
  setMeta(
    'meta[name="twitter:title"]',
    `${pkg.name} - Minecraft Bedrock Addon`,
  );
  setMeta('meta[name="twitter:description"]', desc);
  setMeta('meta[name="twitter:image"]', imgUrl);
}

// Update structured data
function updateStructuredData(pkg) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: pkg.name,
    description: pkg.description || "Minecraft Bedrock addon",
    applicationCategory: "GameApplication",
    operatingSystem: "Android, iOS, Windows, Xbox",
    downloadUrl: `${window.location.origin}/packages/${encodeURIComponent(pkg.name)}/download`,
    softwareVersion: pkg.version || "1.0.0",
    author: {
      "@type": "Person",
      name: pkg.author ? pkg.author.username : "Unknown",
    },
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
  };

  const el = document.getElementById("packageSchema");
  if (el) {
    el.textContent = JSON.stringify(schema);
  }
}

// Check if current user is owner
function checkOwnership() {
  const savedUserId = localStorage.getItem("userId");
  if (savedUserId) {
    currentUserId = parseInt(savedUserId);
  }
}

// Show support popup
function showSupportPopup(downloadUrl, kofiUrl, authorName) {
  const popup = document.getElementById("supportPopup");
  const kofiBtn = document.getElementById("supportKofiBtn");
  const skipBtn = document.getElementById("supportSkipBtn");
  const timerSpan = document.getElementById("supportTimer");
  const authorSpan = document.getElementById("supportAuthorName");

  authorSpan.textContent = authorName;
  kofiBtn.href = kofiUrl;

  popup.style.display = "block";

  let countdown = 3;
  timerSpan.textContent = countdown;
  skipBtn.disabled = true;

  const timer = setInterval(() => {
    countdown--;
    timerSpan.textContent = countdown;

    if (countdown <= 0) {
      clearInterval(timer);
      skipBtn.disabled = false;
      skipBtn.textContent = "No thanks, just download";
    }
  }, 1000);

  skipBtn.onclick = function () {
    clearInterval(timer);
    popup.style.display = "none";
    window.location.href = downloadUrl;
  };

  // Close on background click
  popup.onclick = function (e) {
    if (e.target === popup) {
      clearInterval(timer);
      popup.style.display = "none";
    }
  };
}

// Copy share link
function copyShareLink() {
  navigator.clipboard.writeText(window.location.href).then(() => {
    const btn = document.querySelector(".share-btn");
    const originalText = btn.textContent;
    btn.textContent = "Link Copied!";
    setTimeout(() => {
      btn.textContent = originalText;
    }, 2000);
  });
}

// Toggle video embed
function toggleVideo() {
  const embed = document.getElementById("videoEmbed");
  if (embed) {
    embed.classList.toggle("active");
  }
}

// Render package page
function renderPackage(pkg) {
  const mainContent = document.getElementById("mainContent");
  const breadcrumbName = document.getElementById("breadcrumbName");

  breadcrumbName.textContent = pkg.name;

  const isOwner =
    currentUserId &&
    pkg.author &&
    Number(pkg.author.id) === Number(currentUserId);
  const authorName = pkg.author ? pkg.author.username : "Unknown";

  // Build category HTML
  let categoryHtml = "";
  if (pkg.category) {
    categoryHtml = `
            <div class="hero-tags">
                <a href="/packages.html?category=${encodeURIComponent(pkg.category.slug)}" class="tag">${escapeHtml(pkg.category.name)}</a>
            </div>
        `;
  }

  // Build sidebar category
  let sidebarCategoryHtml = "";
  if (pkg.category) {
    sidebarCategoryHtml = `
            <div class="sidebar-tags">
                <h4>Category</h4>
                <div class="sidebar-tags-list">
                    <a href="/packages.html?category=${encodeURIComponent(pkg.category.slug)}">${escapeHtml(pkg.category.name)}</a>
                </div>
            </div>
        `;
  }

  // Build YouTube section
  let videoHtml = "";
  const videoId = getYouTubeVideoId(pkg.youtube_url);
  if (videoId) {
    videoHtml = `
            <div class="video-section">
                <button class="video-btn" onclick="toggleVideo()">
                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                    </svg>
                    Watch Video
                </button>
                <div class="video-embed" id="videoEmbed">
                    <iframe
                        src="https://www.youtube.com/embed/${videoId}"
                        title="YouTube video player"
                        frameborder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowfullscreen>
                    </iframe>
                </div>
            </div>
        `;
  }

  // Build Ko-fi button
  let kofiHtml = "";
  if (pkg.kofi_url) {
    kofiHtml = `
            <a href="${escapeHtml(pkg.kofi_url)}" target="_blank" rel="noopener noreferrer" class="kofi-btn">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 7.324-.022 11.822c.164 2.424 2.586 2.672 2.586 2.672s8.267-.023 11.966-.049c2.438-.426 2.683-2.566 2.658-3.734 4.352.24 7.422-2.831 6.649-6.916zm-11.062 3.511c-1.246 1.453-4.011 3.976-4.011 3.976s-.121.119-.31.023c-.076-.057-.108-.09-.108-.09-.443-.441-3.368-3.049-4.034-3.954-.709-.965-1.041-2.7-.091-3.71.951-1.01 3.005-1.086 4.363.407 0 0 1.565-1.782 3.468-.963 1.904.82 1.832 3.011.723 4.311z"/>
                </svg>
                Support Creator
            </a>
        `;
  }

  // Build Discord button
  let discordHtml = "";
  if (pkg.discord_url) {
    discordHtml = `
            <a href="${escapeHtml(pkg.discord_url)}" target="_blank" rel="noopener noreferrer" class="discord-btn">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                </svg>
                Join Discord
            </a>
        `;
  }

  // Build download button with optional Ko-fi popup
  const downloadUrl = `${API_URL}/packages/${encodeURIComponent(pkg.name)}/download`;
  let downloadBtnHtml = "";
  if (pkg.kofi_url) {
    downloadBtnHtml = `<button class="download-btn" onclick="showSupportPopup('${downloadUrl}', '${escapeHtml(pkg.kofi_url)}', '${escapeHtml(authorName)}')">Download</button>`;
  } else {
    downloadBtnHtml = `<a href="${downloadUrl}" class="download-btn">Download</a>`;
  }

  // Build edit button (only for owner)
  let editBtnHtml = "";

  // Build markdown content
  let descriptionHtml = "";
  if (pkg.long_description && pkg.long_description.trim()) {
    try {
      const sanitizedMarkdown = sanitizeMarkdown(pkg.long_description);
      descriptionHtml = marked.parse(sanitizedMarkdown);
    } catch (e) {
      console.error("Markdown parsing error:", e);
      descriptionHtml =
        '<div class="no-description">Error rendering description</div>';
    }
  } else {
    descriptionHtml =
      '<div class="no-description">No detailed description available</div>';
  }

   // Icon HTML
   const iconHtml = pkg.icon_url
     ? `<img src="${escapeHtml(pkg.icon_url)}" alt="${escapeHtml(pkg.name)} icon" loading="lazy" onerror="this.parentElement.innerHTML='<span style=font-size:48px;color:#555>&#128230;</span>'">` 
     : '<span style="font-size: 48px; color: #555;">&#128230;</span>';

  mainContent.innerHTML = `
        <div class="main-content">
            <div class="content-area">
                <section class="hero-section">
                    <div class="hero-header">
                        <div class="hero-icon">
                            ${iconHtml}
                        </div>
                        <div class="hero-info">
                            <h1>${escapeHtml(pkg.name)}</h1>
                            <p class="hero-author">By: <a href="/packages.html?author=${encodeURIComponent(authorName)}">${escapeHtml(authorName)}</a></p>
                            <div class="hero-stats">
                                <span>v${escapeHtml(pkg.version || "1.0.0")}</span>
                                <span>${formatDownloads(pkg.downloads)} downloads</span>
                            </div>
                            ${categoryHtml}
                        </div>
                    </div>
                    ${videoHtml}
                </section>

                <section class="description-section">
                    <h2>Description</h2>
                    <div class="markdown-content" id="markdownContent">
                        ${descriptionHtml}
                    </div>
                </section>
            </div>

            <aside class="sidebar">
                <div class="sidebar-card">
                    ${downloadBtnHtml}
                    ${kofiHtml}
                    ${discordHtml}

                    <div class="sidebar-divider"></div>

                    <div class="sidebar-info">
                        <div class="sidebar-info-item">
                            <span class="label">Version</span>
                            <span class="value">${escapeHtml(pkg.version || "1.0.0")}</span>
                        </div>
                        <div class="sidebar-info-item">
                            <span class="label">Updated</span>
                            <span class="value">${formatDate(pkg.updated_at)}</span>
                        </div>
                        <div class="sidebar-info-item">
                            <span class="label">Created</span>
                            <span class="value">${formatDate(pkg.created_at)}</span>
                        </div>
                    </div>

                    ${sidebarCategoryHtml}

                    <div class="sidebar-divider"></div>

                    <div class="sidebar-actions">
                        ${editBtnHtml}
                        <button class="share-btn" onclick="copyShareLink()">Share Link</button>
                    </div>
                </div>
            </aside>
        </div>
    `;

   // Apply syntax highlighting
   if (typeof hljs !== "undefined") {
     document.querySelectorAll("#markdownContent pre code").forEach((block) => {
       hljs.highlightElement(block);
     });
   }

   // Setup lazy loading for markdown images
   setupMarkdownImageLazyLoading();
 }

// Show error state
function showError(message) {
  const mainContent = document.getElementById("mainContent");
  mainContent.innerHTML = `
        <div class="error-state">
            <h2>Package Not Found</h2>
            <p>${escapeHtml(message)}</p>
            <p><a href="/packages.html">Browse all addons</a></p>
        </div>
    `;
  document.getElementById("breadcrumbName").textContent = "Not Found";
}

// Load package data
async function loadPackage() {
  const packageName = getPackageNameFromURL();

  if (!packageName) {
    showError("Invalid package URL");
    return;
  }

  try {
    const response = await fetch(
      `${API_URL}/packages/${encodeURIComponent(packageName)}/full`,
    );

    if (!response.ok) {
      if (response.status === 404) {
        showError("This package does not exist or has been removed.");
      } else {
        showError("Failed to load package. Please try again later.");
      }
      return;
    }

    const result = await response.json();

    if (!result.success || !result.data) {
      showError("Package data is unavailable.");
      return;
    }

    packageData = result.data;

    // Update page
    updateMetaTags(packageData);
    updateStructuredData(packageData);
    renderPackage(packageData);

    // Load related packages after main content
    loadRelatedPackages(packageData);
  } catch (error) {
    console.error("Error loading package:", error);
    showError("An error occurred while loading the package.");
  }
}

// Load related packages based on category
async function loadRelatedPackages(pkg) {
  // Only show related packages if the current package has a category
  if (!pkg.category) {
    return;
  }

  try {
    // Use the dedicated related packages endpoint
    const response = await fetch(
      `${API_URL}/packages/${encodeURIComponent(pkg.name)}/related?limit=6`,
    );

    if (!response.ok) {
      return;
    }

    const result = await response.json();

    if (!result.success || !result.data || result.data.length === 0) {
      return;
    }

     renderRelatedPackages(result.data);
   } catch (error) {
     console.error("Error loading related packages:", error);
     // Silently fail - related packages are optional
   }
 }

// Lazy load images in markdown content
function setupMarkdownImageLazyLoading() {
  const markdownContent = document.getElementById('markdownContent');
  if (!markdownContent) return;

  // Add loading="lazy" to all images in markdown
  markdownContent.querySelectorAll('img').forEach(img => {
    if (!img.hasAttribute('loading')) {
      img.setAttribute('loading', 'lazy');
    }
  });
}

// Render related packages section
function renderRelatedPackages(packages) {
  const contentArea = document.querySelector(".content-area");
  if (!contentArea) return;

  const relatedHtml = `
        <section class="related-section">
            <h2>Similar Addons</h2>
            <div class="related-grid">
                 ${packages
                   .map((pkg) => {
                     const iconHtml = pkg.icon_url
                       ? `<img src="${escapeHtml(pkg.icon_url)}" alt="${escapeHtml(pkg.name)}" loading="lazy" onerror="this.parentElement.innerHTML='<span style=font-size:24px;color:#555>&#128230;</span>'">` 
                       : '<span style="font-size: 24px; color: #555;">&#128230;</span>';

                    const categoryHtml = pkg.category
                      ? `<div class="related-card-tags"><span class="related-card-tag">${escapeHtml(pkg.category.name)}</span></div>`
                      : "";

                    return `
                        <a href="/package/${encodeURIComponent(pkg.name)}" class="related-card">
                            <div class="related-card-header">
                                <div class="related-card-icon">
                                    ${iconHtml}
                                </div>
                                <div class="related-card-info">
                                    <h4>${escapeHtml(pkg.name)}</h4>
                                    <p>${formatDownloads(pkg.downloads)} downloads</p>
                                </div>
                            </div>
                            ${pkg.description ? `<p class="related-card-desc">${escapeHtml(pkg.description)}</p>` : ""}
                            ${categoryHtml}
                        </a>
                    `;
                  })
                  .join("")}
            </div>
        </section>
    `;

  contentArea.insertAdjacentHTML("beforeend", relatedHtml);
}

// Initialize
window.addEventListener("DOMContentLoaded", () => {
  checkOwnership();
  loadPackage();
});
