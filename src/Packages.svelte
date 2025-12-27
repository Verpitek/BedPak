<script>
  import { onMount } from 'svelte'

  // Configuration
  let apiUrl = 'http://localhost:3000'

  // State
  let allPackages = []
  let filteredPackages = []
  let currentPage = 1
  let pageSize = 20
  let sortBy = 'newest'
  let authorCache = {}
  let authToken = null
  let currentUsername = null
  let currentUserId = null
  let devMode = false

  // Filter inputs
  let searchTerm = ''
  let authorTerm = ''
  let categoryFilter = ''

  // Modal states
  let showProfileModal = false
  let showUploadModal = false
  let profileTab = 'login'

  // Upload form
  let uploadForm = {
    name: '',
    description: '',
    longDescription: '',
    version: '1.0.0',
    category: '',
    youtubeUrl: '',
    discordUrl: '',
    kofiUrl: '',
    kofiChecked: false,
    file: null,
    icon: null
  }

  let uploadError = ''
  let uploadSuccess = ''
  let uploadProgress = 0
  let isUploading = false

  // Auth form
  let loginForm = { username: '', password: '' }
  let registerForm = { username: '', email: '', password: '' }
  let authError = ''

  // Turnstile
  let loginTurnstileToken = null
  let registerTurnstileToken = null

  onMount(async () => {
    // Check for API_URL override from window or env
    if (typeof window !== 'undefined' && window.API_URL) {
      apiUrl = window.API_URL
    }

    await fetchConfig()
    await loadPackages()
    checkAuthStatus()
    setupEventListeners()
  })

  async function fetchConfig() {
    try {
      const response = await fetch(`${apiUrl}/api/config`)
      if (response.ok) {
        const config = await response.json()
        devMode = config.devMode || false
      }
    } catch (e) {
      console.error('Failed to fetch config:', e)
    }
  }

  function checkAuthStatus() {
    const savedToken = localStorage.getItem('authToken')
    const savedUsername = localStorage.getItem('username')

    if (savedToken && savedUsername) {
      authToken = savedToken
      currentUsername = savedUsername

      const savedUserId = localStorage.getItem('userId')
      if (savedUserId) {
        currentUserId = parseInt(savedUserId)
      }
    }
  }

  async function handleLogin(e) {
    e.preventDefault()
    authError = ''

    if (!devMode && !loginTurnstileToken) {
      authError = 'Please complete the CAPTCHA verification'
      return
    }

    try {
      const response = await fetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginForm.username,
          password: loginForm.password,
          turnstileToken: devMode ? 'dev-mode' : loginTurnstileToken
        })
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Login failed')
      }

      authToken = data.token
      currentUsername = data.user.username
      currentUserId = data.user.id

      localStorage.setItem('authToken', authToken)
      localStorage.setItem('username', currentUsername)
      localStorage.setItem('userId', currentUserId)

      showProfileModal = false
      loginForm = { username: '', password: '' }
    } catch (error) {
      authError = error.message
      loginTurnstileToken = null
    }
  }

  async function handleRegister(e) {
    e.preventDefault()
    authError = ''

    if (!devMode && !registerTurnstileToken) {
      authError = 'Please complete the CAPTCHA verification'
      return
    }

    try {
      const response = await fetch(`${apiUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: registerForm.username,
          email: registerForm.email,
          password: registerForm.password,
          turnstileToken: devMode ? 'dev-mode' : registerTurnstileToken
        })
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        const errorMsg = Array.isArray(data.details)
          ? data.details.join(', ')
          : data.details || data.error
        throw new Error(errorMsg || 'Registration failed')
      }

      authError = ''
      registerForm = { username: '', email: '', password: '' }
      profileTab = 'login'
      setTimeout(() => {
        authError = 'Registration successful! You can now login.'
      }, 500)
    } catch (error) {
      authError = error.message
      registerTurnstileToken = null
    }
  }

  function handleLogout() {
    authToken = null
    currentUsername = null
    currentUserId = null
    localStorage.removeItem('authToken')
    localStorage.removeItem('username')
    localStorage.removeItem('userId')
    showProfileModal = false
  }

  async function handleUpload(e) {
    e.preventDefault()
    uploadError = ''
    uploadSuccess = ''

    if (!uploadForm.file) {
      uploadError = 'Please select a .mcaddon file.'
      return
    }

    isUploading = true
    uploadProgress = 0

    try {
      uploadProgress = 15
      const fileBase64 = await readFileAsBase64(uploadForm.file)

      let iconBase64 = null
      if (uploadForm.icon) {
        uploadProgress = 30
        iconBase64 = await readFileAsBase64(uploadForm.icon)
      }

      uploadProgress = 50

      const requestBody = {
        name: uploadForm.name,
        description: uploadForm.description,
        version: uploadForm.version || '1.0.0',
        fileBase64
      }

      if (iconBase64)       if (iconBase64) requestBody.iconBase64 = iconBase64
      if (uploadForm.kofiChecked && uploadForm.kofiUrl) requestBody.kofiUrl = uploadForm.kofiUrl
      if (uploadForm.longDescription)
        requestBody.longDescription = uploadForm.longDescription
      if (uploadForm.category) requestBody.category = uploadForm.category
      if (uploadForm.youtubeUrl) requestBody.youtubeUrl = uploadForm.youtubeUrl
      if (uploadForm.discordUrl) requestBody.discordUrl = uploadForm.discordUrl

      const response = await fetch(`${apiUrl}/packages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify(requestBody)
      })

      uploadProgress = 90

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Upload failed')
      }

      uploadProgress = 100
      uploadSuccess = 'Addon uploaded successfully! Refreshing packages...'

      setTimeout(() => {
        loadPackages()
        showUploadModal = false
        uploadForm = {
          name: '',
          description: '',
          longDescription: '',
          version: '1.0.0',
          category: '',
          youtubeUrl: '',
          discordUrl: '',
          kofiUrl: '',
          kofiChecked: false,
          file: null,
          icon: null
        }
        uploadProgress = 0
      }, 1500)
    } catch (error) {
      uploadError = error.message || 'Failed to upload addon. Please try again.'
    } finally {
      isUploading = false
    }
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result
        if (typeof result === 'string') {
          const base64 = result.split(',')[1]
          resolve(base64)
        } else {
          reject(new Error('Failed to read file'))
        }
      }
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsDataURL(file)
    })
  }

  async function loadPackages() {
    try {
      let allPackagesList = []
      let offset = 0
      const limit = 100

      while (true) {
        const response = await fetch(
          `${apiUrl}/packages?limit=${limit}&offset=${offset}`
        )

        if (!response.ok) {
          throw new Error('Failed to load packages')
        }

        const data = await response.json()
        const packages = data.data || []

        if (packages.length === 0) break

        allPackagesList = allPackagesList.concat(packages)
        offset += limit
      }

      // Fetch full data with category
      const packagesWithCategory = await Promise.all(
        allPackagesList.map(async (pkg) => {
          try {
            const fullResp = await fetch(
              `${apiUrl}/packages/${encodeURIComponent(pkg.name)}/full`
            )
            if (fullResp.ok) {
              const fullData = await fullResp.json()
              if (fullData.success && fullData.data) {
                return { ...pkg, category: fullData.data.category || null }
              }
            }
          } catch (e) {
            console.error('Failed to fetch category for', pkg.name)
          }
          return { ...pkg, category: null }
        })
      )

      allPackages = packagesWithCategory

      // Pre-load author names
      const uniqueAuthorIds = [
        ...new Set(allPackagesList.map((p) => p.author_id))
      ]
      for (const authorId of uniqueAuthorIds) {
        await getAuthorName(authorId)
      }

      applyFilters()
    } catch (error) {
      console.error('Error loading packages:', error.message)
    }
  }

  async function getAuthorName(authorId) {
    if (authorCache[authorId]) {
      return authorCache[authorId]
    }

    try {
      const response = await fetch(`${apiUrl}/user/id/${authorId}`)
      if (response.ok) {
        const data = await response.json()
        authorCache[authorId] = data.username || 'Author ' + authorId
      } else {
        authorCache[authorId] = 'Author ' + authorId
      }
    } catch (e) {
      authorCache[authorId] = 'Author ' + authorId
    }

    return authorCache[authorId]
  }

  function applyFilters() {
    currentPage = 1

    filteredPackages = allPackages.filter((pkg) => {
      const matchesSearch =
        (pkg.name && pkg.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (pkg.description &&
          pkg.description.toLowerCase().includes(searchTerm.toLowerCase()))

      let matchesAuthor = true
      if (authorTerm) {
        const authorName = authorCache[pkg.author_id]
        matchesAuthor =
          authorName &&
          authorName.toLowerCase().includes(authorTerm.toLowerCase())
      }

      let matchesCategory = true
      if (categoryFilter) {
        matchesCategory = pkg.category && pkg.category.slug === categoryFilter
      }

      return matchesSearch && matchesAuthor && matchesCategory
    })

    filteredPackages = sortPackages(filteredPackages, sortBy)
  }

  function sortPackages(packages, sortType) {
    const sorted = [...packages]

    switch (sortType) {
      case 'oldest':
        sorted.sort(
          (a, b) => new Date(a.created_at) - new Date(b.created_at)
        )
        break
      case 'downloads':
        sorted.sort((a, b) => (b.downloads || 0) - (a.downloads || 0))
        break
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'newest':
      default:
        sorted.sort(
          (a, b) => new Date(b.created_at) - new Date(a.created_at)
        )
        break
    }

    return sorted
  }

  function getPaginatedPackages() {
    const start = (currentPage - 1) * pageSize
    const end = start + pageSize
    return filteredPackages.slice(start, end)
  }

  function getTotalPages() {
    return Math.ceil(filteredPackages.length / pageSize)
  }

  function goToPage(page) {
    const totalPages = getTotalPages()
    if (page >= 1 && page <= totalPages) {
      currentPage = page
    }
  }

  function changePageSize(size) {
    pageSize = size
    currentPage = 1
  }

  function formatDate(dateString) {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  function escapeHtml(text) {
    if (!text) return ''
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }
    return text.replace(/[&<>"']/g, (m) => map[m])
  }

  function setupEventListeners() {
    // URL parameter handling
    const urlParams = new URLSearchParams(window.location.search)
    const categoryParam = urlParams.get('category')
    if (categoryParam) {
      categoryFilter = categoryParam
    }
    const authorParam = urlParams.get('author')
    if (authorParam) {
      authorTerm = authorParam
    }
  }

  $: if (
    searchTerm ||
    authorTerm ||
    categoryFilter ||
    sortBy !== 'newest'
  ) {
    applyFilters()
  }

  const paginatedPackages = getPaginatedPackages()
  const totalPages = getTotalPages()
  const displayCount = paginatedPackages.length
  const totalCount = filteredPackages.length
</script>

<div class="container">
  <!-- Header -->
  <header class="header">
    <div class="header-left">
      <div class="header-logo">
        <img
          src="/logos/bedpak.svg"
          alt="BedPak - Minecraft Bedrock Addons Repository Logo"
          width="50"
          height="50"
        />
      </div>
      <div style="text-align: left">
        <h1>BedPak Repository</h1>
        <p>Discover and download Minecraft Bedrock addons</p>
      </div>
    </div>
    <nav class="header-right" aria-label="User navigation">
      {#if authToken && currentUsername}
        <div class="profile-user-info">
          <span>Logged in as: <strong>{escapeHtml(currentUsername)}</strong></span>
          <button class="upload-btn" on:click={() => (showUploadModal = true)}>
            Upload Addon
          </button>
          <button class="profile-btn" on:click={() => (showProfileModal = true)}>
            Profile
          </button>
        </div>
      {:else}
        <button class="profile-btn" on:click={() => (showProfileModal = true)}>
          Profile
        </button>
      {/if}
    </nav>
  </header>

  <!-- Main Content -->
  <main aria-label="Package browser">
    <!-- Controls -->
    <section class="controls" aria-label="Search and filter controls">
      <div class="control-group">
        <label for="search">Search Packages</label>
        <input
          type="search"
          id="search"
          placeholder="Search by name or description..."
          bind:value={searchTerm}
          aria-label="Search addons by name or description"
        />
      </div>
      <div class="control-group">
        <label for="author">Filter by Author</label>
        <input
          type="text"
          id="author"
          placeholder="Search author..."
          bind:value={authorTerm}
          aria-label="Filter addons by author name"
        />
      </div>
      <div class="control-group">
        <label for="categoryFilter">Filter by Category</label>
        <select
          id="categoryFilter"
          bind:value={categoryFilter}
          aria-label="Filter addons by category"
        >
          <option value="">All Categories</option>
          <optgroup label="Gameplay">
            <option value="adventure">Adventure</option>
            <option value="decoration">Decoration</option>
            <option value="economy">Economy</option>
            <option value="equipment">Equipment</option>
            <option value="food">Food</option>
            <option value="game-mechanics">Game Mechanics</option>
            <option value="magic">Magic</option>
            <option value="management">Management</option>
            <option value="minigame">Minigame</option>
            <option value="mobs">Mobs</option>
            <option value="optimisation">Optimisation</option>
            <option value="social">Social</option>
            <option value="storage">Storage</option>
            <option value="technology">Technology</option>
            <option value="transportation">Transportation</option>
            <option value="utility">Utility</option>
            <option value="world-generation">World Generation</option>
          </optgroup>
          <optgroup label="Server">
            <option value="administration">Administration</option>
            <option value="anti-cheat">Anti-Cheat</option>
            <option value="chat">Chat</option>
            <option value="moderation">Moderation</option>
            <option value="permissions">Permissions</option>
          </optgroup>
        </select>
      </div>
      <div class="control-group">
        <label for="sortBy">Sort By</label>
        <select
          id="sortBy"
          bind:value={sortBy}
          aria-label="Sort packages"
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="downloads">Most Downloaded</option>
          <option value="name">Name (A-Z)</option>
        </select>
      </div>
    </section>

    <!-- Package Info and Pagination Controls -->
    <div
      class="packages-info"
      aria-label="Package count and pagination options"
    >
      <span class="packages-count" aria-live="polite">
        Showing <strong>{displayCount}</strong> of
        <strong>{totalCount}</strong> packages
      </span>
      <div class="sort-options" role="group" aria-label="Items per page">
        <button
          class="sort-btn {pageSize === 12 ? 'active' : ''}"
          on:click={() => changePageSize(12)}
          aria-label="Show 12 packages per page"
        >
          12 Per Page
        </button>
        <button
          class="sort-btn {pageSize === 20 ? 'active' : ''}"
          on:click={() => changePageSize(20)}
          aria-label="Show 20 packages per page"
        >
          20 Per Page
        </button>
        <button
          class="sort-btn {pageSize === 50 ? 'active' : ''}"
          on:click={() => changePageSize(50)}
          aria-label="Show 50 packages per page"
        >
          50 Per Page
        </button>
      </div>
    </div>

    <!-- Packages List -->
    <section
      id="packagesContainer"
      class="packages-list"
      aria-label="Minecraft Bedrock addons list"
    >
      {#if paginatedPackages.length === 0}
        <div class="empty-state">
          <p>No packages found</p>
          <p style="font-size: 12px; color: #555;">Try adjusting your filters</p>
        </div>
      {:else}
        {#each paginatedPackages as pkg (pkg.id)}
          {@const authorName = authorCache[pkg.author_id] || 'Unknown Author'}
          {@const isOwner = currentUserId && Number(pkg.author_id) === Number(currentUserId)}
          {@const downloadUrl = `${apiUrl}/packages/${encodeURIComponent(pkg.name)}/download`}
          <div class="package-card">
            <div class="package-icon">
              {#if pkg.icon_url}
                <img
                  src={pkg.icon_url}
                  alt="{escapeHtml(pkg.name)} icon"
                  on:error={(e) => (e.target.style.display = 'none')}
                />
              {:else}
                <span style="font-size: 48px; color: #555;">📦</span>
              {/if}
            </div>
            <h3>{escapeHtml(pkg.name)}</h3>
            <div class="package-meta">
              <span>Downloads: {pkg.downloads || 0}</span>
              <span>Date: {formatDate(pkg.created_at)}</span>
            </div>
            {#if pkg.category}
              <div class="package-category">
                <a
                  href="/packages.html?category={encodeURIComponent(pkg.category.slug)}"
                  class="category-badge"
                >
                  {escapeHtml(pkg.category.name)}
                </a>
              </div>
            {/if}
            <p class="package-description">
              {escapeHtml(pkg.description || 'No description provided')}
            </p>
            <span class="package-version">Version {pkg.version || '1.0.0'}</span>
            <p class="package-author">By: {escapeHtml(authorName)}</p>
            <div class="package-actions">
              <a href="/package/{encodeURIComponent(pkg.name)}" class="view-details-btn">
                View Details
              </a>
              {#if pkg.kofi_url}
                <button class="download-btn" on:click={() => (showSupportPopup = true)}>
                  Download
                </button>
              {:else}
                <a href={downloadUrl} class="download-btn" download>
                  Download
                </a>
              {/if}
              {#if isOwner}
                <button class="edit-btn">Edit</button>
              {/if}
            </div>
          </div>
        {/each}
      {/if}
    </section>

    <!-- Pagination -->
    {#if totalPages > 1}
      <nav class="pagination" aria-label="Package list pagination">
        <button
          on:click={() => goToPage(currentPage - 1)}
          disabled={currentPage === 1}
        >
          Previous
        </button>

        {#if currentPage > 3}
          <button on:click={() => goToPage(1)}>1</button>
          {#if currentPage > 4}
            <span>...</span>
          {/if}
        {/if}

        {#each Array.from({length: Math.min(5, totalPages)}, (_, i) => Math.max(1, currentPage - 2 + i)) as page}
          {#if page <= totalPages}
            <button
              on:click={() => goToPage(page)}
              class={page === currentPage ? 'active' : ''}
            >
              {page}
            </button>
          {/if}
        {/each}

        {#if currentPage < totalPages - 2}
          {#if currentPage < totalPages - 3}
            <span>...</span>
          {/if}
          <button on:click={() => goToPage(totalPages)}>{totalPages}</button>
        {/if}

        <button
          on:click={() => goToPage(currentPage + 1)}
          disabled={currentPage === totalPages}
        >
          Next
        </button>
      </nav>
    {/if}
  </main>

  <!-- Footer -->
  <footer class="footer">
    <div class="footer-content">
      <nav class="footer-links" aria-label="Footer navigation">
        <a href="/packages.html">Browse Addons</a>
        <a href="/api-docs.html">API Documentation</a>
        <a href="/terms-of-service.html">Terms of Service</a>
        <a href="/privacy-policy.html">Privacy Policy</a>
        <a
          href="https://discord.gg/fyNQNrr7dC"
          target="_blank"
          rel="noopener noreferrer"
        >
          Discord Community
        </a>
      </nav>
      <div class="footer-divider"></div>
      <p>&copy; 2025 BedPak. All rights reserved.</p>
      <p>
        BedPak is an independent service and is not affiliated with Microsoft or
        Mojang Studios.
      </p>
      <p>Minecraft is a trademark of Mojang Studios.</p>
    </div>
  </footer>
</div>

<!-- Profile Modal -->
{#if showProfileModal}
  <div
    class="modal"
    on:click={() => (showProfileModal = false)}
    on:keydown={(e) => e.key === 'Escape' && (showProfileModal = false)}
    role="dialog"
  >
    <div class="modal-content" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Profile</h2>
        <button class="close-btn" on:click={() => (showProfileModal = false)}>
          &times;
        </button>
      </div>

      {#if authToken && currentUsername}
        <!-- Logged in view -->
        <div
          class="profile-user-info"
          style="justify-content: space-between; margin-bottom: 20px;"
        >
          <div>
            <p style="margin-bottom: 8px;">Logged in as:</p>
            <p style="color: #4a6fa5; font-weight: 600;">
              {escapeHtml(currentUsername)}
            </p>
          </div>
        </div>
        <button
          class="form-btn logout-btn"
          on:click={handleLogout}
          style="width: 100%; background: #5a3a3a"
        >
          Logout
        </button>
      {:else}
        <!-- Auth tabs -->
        <div class="tab-buttons">
          <button
            class="tab-btn {profileTab === 'login' ? 'active' : ''}"
            on:click={() => {
              profileTab = 'login'
              authError = ''
            }}
          >
            Login
          </button>
          <button
            class="tab-btn {profileTab === 'register' ? 'active' : ''}"
            on:click={() => {
              profileTab = 'register'
              authError = ''
            }}
          >
            Register
          </button>
        </div>

        <!-- Login Tab -->
        {#if profileTab === 'login'}
          {#if authError}
            <div class="form-error" style="display: block;">
              {authError}
            </div>
          {/if}
          <form on:submit={handleLogin}>
            <div class="form-group">
              <label for="loginUsername">Username</label>
              <input
                type="text"
                id="loginUsername"
                placeholder="Enter your username"
                bind:value={loginForm.username}
                required
              />
            </div>
            <div class="form-group">
              <label for="loginPassword">Password</label>
              <input
                type="password"
                id="loginPassword"
                placeholder="Enter your password"
                bind:value={loginForm.password}
                required
              />
            </div>
            {#if !devMode}
              <div class="form-group">
                <div
                  class="cf-turnstile"
                  data-sitekey="0x4AAAAAACI85z04hVdplopt"
                  data-theme="dark"
                  data-callback="onLoginTurnstileSuccess"
                  data-expired-callback="onLoginTurnstileExpired"
                />
              </div>
            {/if}
            <button type="submit" class="form-btn"> Login </button>
          </form>
        {/if}

        <!-- Register Tab -->
        {#if profileTab === 'register'}
          {#if authError}
            <div class="form-error" style="display: block;">
              {authError}
            </div>
          {/if}
          <form on:submit={handleRegister}>
            <div class="form-group">
              <label for="registerUsername">Username</label>
              <input
                type="text"
                id="registerUsername"
                placeholder="Choose a username"
                bind:value={registerForm.username}
                required
              />
            </div>
            <div class="form-group">
              <label for="registerEmail">Email</label>
              <input
                type="email"
                id="registerEmail"
                placeholder="Enter your email"
                bind:value={registerForm.email}
                required
              />
            </div>
            <div class="form-group">
              <label for="registerPassword">Password</label>
              <input
                type="password"
                id="registerPassword"
                placeholder="Enter your password"
                bind:value={registerForm.password}
                required
              />
              <div class="password-help">
                • At least 8 characters<br />
                • At least 1 number<br />
                • At least 1 special character (!@#$%^&* etc.)
              </div>
            </div>
            {#if !devMode}
              <div class="form-group">
                <div
                  class="cf-turnstile"
                  data-sitekey="0x4AAAAAACI85z04hVdplopt"
                  data-theme="dark"
                  data-callback="onRegisterTurnstileSuccess"
                  data-expired-callback="onRegisterTurnstileExpired"
                />
              </div>
            {/if}
            <button type="submit" class="form-btn"> Register </button>
          </form>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<!-- Upload Modal -->
{#if showUploadModal && authToken}
  <div
    class="modal"
    on:click={() => (showUploadModal = false)}
    on:keydown={(e) => e.key === 'Escape' && (showUploadModal = false)}
    role="dialog"
  >
    <div class="modal-content" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Upload Addon</h2>
        <button class="close-btn" on:click={() => (showUploadModal = false)}>
          &times;
        </button>
      </div>

      {#if uploadError}
        <div class="form-error" style="display: block;">
          {uploadError}
        </div>
      {/if}
      {#if uploadSuccess}
        <div class="form-success" style="display: block;">
          {uploadSuccess}
        </div>
      {/if}

      <form on:submit={handleUpload}>
        <div class="form-group">
          <label for="uploadName">Package Name *</label>
          <input
            type="text"
            id="uploadName"
            placeholder="MyAwesomeAddon"
            bind:value={uploadForm.name}
            required
            pattern="^[a-zA-Z0-9_-]{1,64}$"
          />
          <div class="password-help">
            Only letters, numbers, underscores, and hyphens (1-64 chars)
          </div>
        </div>
        <div class="form-group">
          <label for="uploadDescription">Short Description</label>
          <textarea
            id="uploadDescription"
            placeholder="Brief description for the package listing..."
            bind:value={uploadForm.description}
            rows="2"
            class="form-textarea"
            maxlength="500"
          ></textarea>
          <div class="password-help">Shown in package cards. Max 500 characters.</div>
        </div>
        <div class="form-group">
          <label for="uploadCategory">Category</label>
          <select id="uploadCategory" bind:value={uploadForm.category}>
            <option value="">Select a category...</option>
            <optgroup label="Gameplay">
              <option value="adventure">Adventure</option>
              <option value="decoration">Decoration</option>
              <option value="economy">Economy</option>
              <option value="equipment">Equipment</option>
              <option value="food">Food</option>
              <option value="game-mechanics">Game Mechanics</option>
              <option value="magic">Magic</option>
              <option value="management">Management</option>
              <option value="minigame">Minigame</option>
              <option value="mobs">Mobs</option>
              <option value="optimisation">Optimisation</option>
              <option value="social">Social</option>
              <option value="storage">Storage</option>
              <option value="technology">Technology</option>
              <option value="transportation">Transportation</option>
              <option value="utility">Utility</option>
              <option value="world-generation">World Generation</option>
            </optgroup>
            <optgroup label="Server">
              <option value="administration">Administration</option>
              <option value="anti-cheat">Anti-Cheat</option>
              <option value="chat">Chat</option>
              <option value="moderation">Moderation</option>
              <option value="permissions">Permissions</option>
            </optgroup>
          </select>
        </div>
        <div class="form-group">
          <label for="uploadFile">Addon File (.mcaddon) *</label>
          <div class="file-input-wrapper">
            <button
              type="button"
              class="file-select-btn"
              on:click={() =>
                document.querySelector('input[name="uploadFile"]').click()}
            >
              Choose File
            </button>
            <span class="selected-file-name">
              {uploadForm.file ? uploadForm.file.name : 'No file selected'}
            </span>
              <input
                type="file"
                name="uploadFile"
                accept=".mcaddon"
                on:change={(e) => (uploadForm.file = e.target.files ? e.target.files[0] : null)}
                style="display: none"
              />
          </div>
          <div class="password-help">
            Maximum file size: 200MB. Only .mcaddon files are accepted.
          </div>
        </div>

        {#if uploadProgress > 0}
          <div class="upload-progress">
            <div class="progress-bar">
              <div class="progress-fill" style="width: {uploadProgress}%;"></div>
            </div>
            <span id="progressText">Uploading... {uploadProgress}%</span>
          </div>
        {/if}

        <button type="submit" class="form-btn" disabled={isUploading}>
          {isUploading ? 'Uploading...' : 'Upload Addon'}
        </button>
      </form>
    </div>
  </div>
{/if}

<style>
  @import './styles/global.css';
</style>
