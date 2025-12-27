const API_URL = "";
let allPackages = [];
let filteredPackages = [];
let currentPage = 1;
let pageSize = 20;
let sortBy = "newest";
let authorCache = {};
let authToken = null;
let currentUsername = null;
let currentUserId = null;
let totalPages = 0;
let totalPackages = 0;

// Turnstile tokens
let loginTurnstileToken = null;
let registerTurnstileToken = null;

// Dev mode flag (fetched from server)
let devMode = false;

// Fetch config from server to check dev mode
async function fetchConfig() {
  try {
    const response = await fetch(`${API_URL}/api/config`);
    if (response.ok) {
      const config = await response.json();
      devMode = config.devMode || false;
      if (devMode) {
        console.log("Dev mode enabled - CAPTCHA bypassed");
        // Hide turnstile widgets in dev mode
        document.querySelectorAll(".cf-turnstile").forEach((el) => {
          el.style.display = "none";
        });
      }
    }
  } catch (e) {
    console.error("Failed to fetch config:", e);
  }
}

// Turnstile callbacks
function onLoginTurnstileSuccess(token) {
  loginTurnstileToken = token;
}

function onLoginTurnstileExpired() {
  loginTurnstileToken = null;
}

function onRegisterTurnstileSuccess(token) {
  registerTurnstileToken = token;
}

function onRegisterTurnstileExpired() {
  registerTurnstileToken = null;
}

window.addEventListener("DOMContentLoaded", async () => {
  await fetchConfig();
  loadPackages();
  setupEventListeners();
  checkAuthStatus();
  handleEditHash();
});

window.addEventListener("hashchange", handleEditHash);

async function checkAuthStatus() {
  const savedToken = localStorage.getItem("authToken");
  const savedUsername = localStorage.getItem("username");

  if (savedToken && savedUsername) {
    authToken = savedToken;
    currentUsername = savedUsername;

    // Fetch user ID for ownership checks
    try {
      const response = await fetch(`${API_URL}/user/${savedUsername}`);
      if (response.ok) {
        const userData = await response.json();
        currentUserId = userData.id;
        localStorage.setItem("userId", currentUserId);
      }
    } catch (e) {
      // Try to get from localStorage as fallback
      const savedUserId = localStorage.getItem("userId");
      if (savedUserId) {
        currentUserId = parseInt(savedUserId);
      }
    }

    updateProfileUI();
  }
}

function updateProfileUI() {
  const headerRight = document.getElementById("headerRight");
  if (authToken && currentUsername) {
    headerRight.innerHTML = `
<div class="profile-user-info">
  <span>Logged in as: <strong>${escapeHtml(currentUsername)}</strong></span>
  <button class="upload-btn" onclick="openUploadModal()">Upload Addon</button>
  <button class="profile-btn" onclick="openProfileModal()">Profile</button>
</div>
`;
  } else {
    headerRight.innerHTML = `<button class="profile-btn" onclick="openProfileModal()">Profile</button>`;
  }
}

function openProfileModal() {
  const modal = document.getElementById("profileModal");
  modal.style.display = "block";

  if (authToken && currentUsername) {
    document.getElementById("authContainer").style.display = "none";
    document.getElementById("profileContainer").style.display = "block";
    document.getElementById("loggedUsername").textContent = currentUsername;
  } else {
    document.getElementById("authContainer").style.display = "block";
    document.getElementById("profileContainer").style.display = "none";
    switchTab("login");
  }
}

function closeProfileModal() {
  const modal = document.getElementById("profileModal");
  modal.style.display = "none";
}

window.onclick = function (event) {
  const modal = document.getElementById("profileModal");
  if (event.target === modal) {
    modal.style.display = "none";
  }
};

function switchTab(tabName) {
  // Hide all tab content and remove active class from buttons
  document.querySelectorAll(".tab-content").forEach((tab) => {
    tab.classList.remove("active");
  });
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove("active");
  });

  // Show selected tab and mark button as active
  const selectedTab = document.getElementById(tabName);
  if (selectedTab) {
    selectedTab.classList.add("active");
  }

  const selectedBtn = document.querySelector(`[data-tab="${tabName}"]`);
  if (selectedBtn) {
    selectedBtn.classList.add("active");
  }

  // Clear error messages
  document.getElementById("loginError").style.display = "none";
  document.getElementById("registerError").style.display = "none";
  document.getElementById("registerSuccess").style.display = "none";
}

async function handleLogin(event) {
  event.preventDefault();

  const username = document.getElementById("loginUsername").value;
  const password = document.getElementById("loginPassword").value;
  const loginBtn = document.getElementById("loginBtn");
  const errorDiv = document.getElementById("loginError");

  errorDiv.style.display = "none";

  // Check Turnstile token (skip in dev mode)
  if (!devMode && !loginTurnstileToken) {
    errorDiv.textContent = "Please complete the CAPTCHA verification";
    errorDiv.style.display = "block";
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = "Logging in...";

  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username,
        password,
        turnstileToken: devMode ? "dev-mode" : loginTurnstileToken,
      }),
    });

    const data = await response.json();
    console.log("Login response:", data);

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Login failed");
    }

    authToken = data.token;
    currentUsername = data.user.username;
    currentUserId = data.user.id;

    console.log("Setting auth:", {
      authToken,
      currentUsername,
      currentUserId,
    });
    localStorage.setItem("authToken", authToken);
    localStorage.setItem("username", currentUsername);
    localStorage.setItem("userId", currentUserId);
    console.log("Stored in localStorage:", {
      authToken: localStorage.getItem("authToken"),
      username: localStorage.getItem("username"),
      userId: localStorage.getItem("userId"),
    });

    updateProfileUI();
    closeProfileModal();

    // Clear form
    document.getElementById("loginUsername").value = "";
    document.getElementById("loginPassword").value = "";
  } catch (error) {
    console.error("Login error:", error);
    errorDiv.textContent = error.message;
    errorDiv.style.display = "block";
    // Reset Turnstile on error
    loginTurnstileToken = null;
    if (typeof turnstile !== "undefined") {
      turnstile.reset(document.querySelector("#loginTurnstile"));
    }
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Login";
  }
}

async function handleRegister(event) {
  event.preventDefault();

  const username = document.getElementById("registerUsername").value;
  const email = document.getElementById("registerEmail").value;
  const password = document.getElementById("registerPassword").value;
  const registerBtn = document.getElementById("registerBtn");
  const errorDiv = document.getElementById("registerError");
  const successDiv = document.getElementById("registerSuccess");

  errorDiv.style.display = "none";
  successDiv.style.display = "none";

  // Check Turnstile token (skip in dev mode)
  if (!devMode && !registerTurnstileToken) {
    errorDiv.textContent = "Please complete the CAPTCHA verification";
    errorDiv.style.display = "block";
    return;
  }

  registerBtn.disabled = true;
  registerBtn.textContent = "Registering...";

  try {
    const response = await fetch(`${API_URL}/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username,
        email,
        password,
        turnstileToken: devMode ? "dev-mode" : registerTurnstileToken,
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      const errorMsg = data.details
        ? Array.isArray(data.details)
          ? data.details.join(", ")
          : data.details
        : data.error;
      throw new Error(errorMsg || "Registration failed");
    }

    successDiv.textContent = "Registration successful! You can now login.";
    successDiv.style.display = "block";

    // Clear form
    document.getElementById("registerUsername").value = "";
    document.getElementById("registerEmail").value = "";
    document.getElementById("registerPassword").value = "";

    // Switch to login tab after 2 seconds
    setTimeout(() => {
      document.querySelector(".tab-btn").click();
    }, 2000);
  } catch (error) {
    errorDiv.textContent = error.message;
    errorDiv.style.display = "block";
    // Reset Turnstile on error
    registerTurnstileToken = null;
    if (typeof turnstile !== "undefined") {
      turnstile.reset(document.querySelector("#registerTurnstile"));
    }
  } finally {
    registerBtn.disabled = false;
    registerBtn.textContent = "Register";
  }
}

function handleLogout() {
  authToken = null;
  currentUsername = null;
  currentUserId = null;
  localStorage.removeItem("authToken");
  localStorage.removeItem("username");
  localStorage.removeItem("userId");

  updateProfileUI();
  closeProfileModal();

  // Re-render packages to remove edit buttons
  renderPackages();
}

// Upload Modal Functions
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB

// Upload form persistence keys
const UPLOAD_FORM_STORAGE_KEY = "bedpak_upload_form_draft";

function saveUploadFormData() {
  const formData = {
    name: document.getElementById("uploadName").value,
    description: document.getElementById("uploadDescription").value,
    longDescription: document.getElementById("uploadLongDescription").value,
    version: document.getElementById("uploadVersion").value,
    category: document.getElementById("uploadCategory").value,
    youtubeUrl: document.getElementById("uploadYoutube").value,
    discordUrl: document.getElementById("uploadDiscord").value,
    kofiChecked: document.getElementById("uploadKofiCheckbox").checked,
    kofiUrl: document.getElementById("uploadKofiUrl").value,
  };
  sessionStorage.setItem(UPLOAD_FORM_STORAGE_KEY, JSON.stringify(formData));
}

function restoreUploadFormData() {
  const savedData = sessionStorage.getItem(UPLOAD_FORM_STORAGE_KEY);
  if (!savedData) return false;

  try {
    const formData = JSON.parse(savedData);
    document.getElementById("uploadName").value = formData.name || "";
    document.getElementById("uploadDescription").value =
      formData.description || "";
    document.getElementById("uploadLongDescription").value =
      formData.longDescription || "";
    document.getElementById("uploadVersion").value = formData.version || "";
    document.getElementById("uploadCategory").value = formData.category || "";
    document.getElementById("uploadYoutube").value = formData.youtubeUrl || "";
    document.getElementById("uploadDiscord").value = formData.discordUrl || "";

    // Restore Ko-fi checkbox and URL
    const kofiCheckbox = document.getElementById("uploadKofiCheckbox");
    kofiCheckbox.checked = formData.kofiChecked || false;
    document.getElementById("uploadKofiGroup").style.display =
      formData.kofiChecked ? "block" : "none";
    document.getElementById("uploadKofiUrl").value = formData.kofiUrl || "";

    return true;
  } catch (e) {
    console.error("Failed to restore upload form data:", e);
    return false;
  }
}

function clearUploadFormData() {
  sessionStorage.removeItem(UPLOAD_FORM_STORAGE_KEY);
}

function openUploadModal() {
  if (!authToken) {
    openProfileModal();
    return;
  }
  const modal = document.getElementById("uploadModal");
  modal.style.display = "block";

  // Try to restore saved form data, otherwise reset
  if (!restoreUploadFormData()) {
    resetUploadForm();
  } else {
    // Even when restoring, we need to reset UI state elements
    document.getElementById("uploadError").style.display = "none";
    document.getElementById("uploadSuccess").style.display = "none";
    document.getElementById("uploadProgress").style.display = "none";
    document.getElementById("uploadBtn").disabled = false;
    document.getElementById("uploadBtn").textContent = "Upload Addon";
    // File inputs can't be restored for security reasons, so reset their display
    document.getElementById("selectedFileName").textContent =
      "No file selected";
    document.getElementById("selectedFileName").classList.remove("has-file");
    document.getElementById("selectedIconName").textContent =
      "No icon selected";
    document.getElementById("selectedIconName").classList.remove("has-file");
    document.getElementById("iconPreviewContainer").style.display = "none";
  }
}

function closeUploadModal() {
  const modal = document.getElementById("uploadModal");
  modal.style.display = "none";
  // Save form data before closing so user doesn't lose their input
  saveUploadFormData();
}

function resetUploadForm() {
  document.getElementById("uploadForm").reset();
  document.getElementById("uploadError").style.display = "none";
  document.getElementById("uploadSuccess").style.display = "none";
  document.getElementById("uploadProgress").style.display = "none";
  document.getElementById("selectedFileName").textContent = "No file selected";
  document.getElementById("selectedFileName").classList.remove("has-file");
  document.getElementById("selectedIconName").textContent = "No icon selected";
  document.getElementById("selectedIconName").classList.remove("has-file");
  document.getElementById("iconPreviewContainer").style.display = "none";
  document.getElementById("uploadBtn").disabled = false;
  document.getElementById("uploadBtn").textContent = "Upload Addon";
  // Reset Ko-fi fields
  document.getElementById("uploadKofiCheckbox").checked = false;
  document.getElementById("uploadKofiGroup").style.display = "none";
  document.getElementById("uploadKofiUrl").value = "";
  // Reset long description
  document.getElementById("uploadLongDescription").value = "";
  // Reset category, youtube, and discord
  document.getElementById("uploadCategory").value = "";
  document.getElementById("uploadYoutube").value = "";
  document.getElementById("uploadDiscord").value = "";
}

// Handle file selection display
document.addEventListener("DOMContentLoaded", function () {
  const fileInput = document.getElementById("uploadFile");
  if (fileInput) {
    fileInput.addEventListener("change", function () {
      const fileName = document.getElementById("selectedFileName");
      if (this.files && this.files.length > 0) {
        const file = this.files[0];
        fileName.textContent = file.name;
        fileName.classList.add("has-file");

        // Validate file immediately on selection
        const validation = validateFile(file);
        if (!validation.valid) {
          showUploadError(validation.error);
          this.value = "";
          fileName.textContent = "No file selected";
          fileName.classList.remove("has-file");
        }
      } else {
        fileName.textContent = "No file selected";
        fileName.classList.remove("has-file");
      }
    });
  }

  // Handle icon file selection
  const iconInput = document.getElementById("uploadIcon");
  if (iconInput) {
    iconInput.addEventListener("change", function () {
      const iconName = document.getElementById("selectedIconName");
      const previewContainer = document.getElementById("iconPreviewContainer");
      const preview = document.getElementById("iconPreview");

      if (this.files && this.files.length > 0) {
        const file = this.files[0];

        // Validate icon
        const validation = validateIcon(file);
        if (!validation.valid) {
          showUploadError(validation.error);
          this.value = "";
          iconName.textContent = "No icon selected";
          iconName.classList.remove("has-file");
          previewContainer.style.display = "none";
          return;
        }

        iconName.textContent = file.name;
        iconName.classList.add("has-file");

        // Show preview
        const reader = new FileReader();
        reader.onload = function (e) {
          preview.src = e.target.result;
          previewContainer.style.display = "block";
        };
        reader.readAsDataURL(file);
      } else {
        iconName.textContent = "No icon selected";
        iconName.classList.remove("has-file");
        previewContainer.style.display = "none";
      }
    });
  }

  // Upload modal: toggle Ko-fi URL section
  const uploadKofiCheckbox = document.getElementById("uploadKofiCheckbox");
  if (uploadKofiCheckbox) {
    uploadKofiCheckbox.addEventListener("change", function () {
      document.getElementById("uploadKofiGroup").style.display = this.checked
        ? "block"
        : "none";
      if (!this.checked) {
        document.getElementById("uploadKofiUrl").value = "";
      }
    });
  }

  // Edit modal: toggle icon/file update sections
  const updateIconCheckbox = document.getElementById("updateIconCheckbox");
  if (updateIconCheckbox) {
    updateIconCheckbox.addEventListener("change", function () {
      document.getElementById("editIconGroup").style.display = this.checked
        ? "block"
        : "none";
      if (!this.checked) {
        document.getElementById("editIcon").value = "";
        document.getElementById("editSelectedIconName").textContent =
          "No icon selected";
        document
          .getElementById("editSelectedIconName")
          .classList.remove("has-file");
        document.getElementById("editIconPreviewContainer").style.display =
          "none";
      }
    });
  }

  const updateFileCheckbox = document.getElementById("updateFileCheckbox");
  if (updateFileCheckbox) {
    updateFileCheckbox.addEventListener("change", function () {
      document.getElementById("editFileGroup").style.display = this.checked
        ? "block"
        : "none";
      if (!this.checked) {
        document.getElementById("editFile").value = "";
        document.getElementById("editSelectedFileName").textContent =
          "No file selected";
        document
          .getElementById("editSelectedFileName")
          .classList.remove("has-file");
      }
    });
  }

  // Edit modal: handle icon file selection
  const editIconInput = document.getElementById("editIcon");
  if (editIconInput) {
    editIconInput.addEventListener("change", function () {
      const editIconName = document.getElementById("editSelectedIconName");
      const editPreviewContainer = document.getElementById(
        "editIconPreviewContainer",
      );
      const editPreview = document.getElementById("editIconPreview");

      if (this.files && this.files.length > 0) {
        const file = this.files[0];

        // Validate icon
        const validation = validateIcon(file);
        if (!validation.valid) {
          showEditError(validation.error);
          this.value = "";
          editIconName.textContent = "No icon selected";
          editIconName.classList.remove("has-file");
          editPreviewContainer.style.display = "none";
          return;
        }

        editIconName.textContent = file.name;
        editIconName.classList.add("has-file");

        // Show preview
        const reader = new FileReader();
        reader.onload = function (e) {
          editPreview.src = e.target.result;
          editPreviewContainer.style.display = "block";
        };
        reader.readAsDataURL(file);
      } else {
        editIconName.textContent = "No icon selected";
        editIconName.classList.remove("has-file");
        editPreviewContainer.style.display = "none";
      }
    });
  }

  // Edit modal: handle addon file selection
  const editFileInput = document.getElementById("editFile");
  if (editFileInput) {
    editFileInput.addEventListener("change", function () {
      const editFileName = document.getElementById("editSelectedFileName");
      if (this.files && this.files.length > 0) {
        const file = this.files[0];

        // Validate file
        const validation = validateFile(file);
        if (!validation.valid) {
          showEditError(validation.error);
          this.value = "";
          editFileName.textContent = "No file selected";
          editFileName.classList.remove("has-file");
          return;
        }

        editFileName.textContent = file.name;
        editFileName.classList.add("has-file");
      } else {
        editFileName.textContent = "No file selected";
        editFileName.classList.remove("has-file");
      }
    });
  }

  // Edit modal: toggle Ko-fi URL section
  const editKofiCheckbox = document.getElementById("editKofiCheckbox");
  if (editKofiCheckbox) {
    editKofiCheckbox.addEventListener("change", function () {
      document.getElementById("editKofiGroup").style.display = this.checked
        ? "block"
        : "none";
      if (!this.checked) {
        document.getElementById("editKofiUrl").value = "";
      }
    });
  }
});

const MAX_ICON_SIZE = 2 * 1024 * 1024; // 2MB

function validateIcon(file) {
  // Check file size
  if (file.size > MAX_ICON_SIZE) {
    return {
      valid: false,
      error: `Icon too large. Maximum size is ${MAX_ICON_SIZE / (1024 * 1024)}MB`,
    };
  }

  // Check file type
  const validTypes = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/svg+xml",
  ];
  // Also check extension for SVG (some browsers report different mime types)
  const isSvg = file.name.toLowerCase().endsWith(".svg");
  if (!validTypes.includes(file.type) && !isSvg) {
    return {
      valid: false,
      error:
        "Invalid icon type. Only PNG, JPG, WebP, GIF, and SVG are accepted.",
    };
  }

  return { valid: true };
}

function validateFile(file) {
  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
    };
  }

  // Check file extension
  if (!file.name.toLowerCase().endsWith(".mcaddon")) {
    return {
      valid: false,
      error: "Invalid file type. Only .mcaddon files are accepted.",
    };
  }

  return { valid: true };
}

function showUploadError(message) {
  const errorDiv = document.getElementById("uploadError");
  errorDiv.textContent = message;
  errorDiv.style.display = "block";
  document.getElementById("uploadSuccess").style.display = "none";
}

function showUploadSuccess(message) {
  const successDiv = document.getElementById("uploadSuccess");
  successDiv.textContent = message;
  successDiv.style.display = "block";
  document.getElementById("uploadError").style.display = "none";
}

async function handleUpload(event) {
  event.preventDefault();

  const name = document.getElementById("uploadName").value.trim();
  const description = document.getElementById("uploadDescription").value.trim();
  const longDescription = document
    .getElementById("uploadLongDescription")
    .value.trim();
  const version =
    document.getElementById("uploadVersion").value.trim() || "1.0.0";
  const fileInput = document.getElementById("uploadFile");
  const iconInput = document.getElementById("uploadIcon");
  const uploadBtn = document.getElementById("uploadBtn");
  const progressDiv = document.getElementById("uploadProgress");
  const progressFill = document.getElementById("progressFill");
  const progressText = document.getElementById("progressText");
  const kofiCheckbox = document.getElementById("uploadKofiCheckbox");
  const kofiUrl = kofiCheckbox.checked
    ? document.getElementById("uploadKofiUrl").value.trim()
    : "";
  // Category, YouTube, and Discord
  const category = document.getElementById("uploadCategory").value;
  const youtubeUrl = document.getElementById("uploadYoutube").value.trim();
  const discordUrl = document.getElementById("uploadDiscord").value.trim();

  // Reset messages
  document.getElementById("uploadError").style.display = "none";
  document.getElementById("uploadSuccess").style.display = "none";

  // Validate name format
  const nameRegex = /^[a-zA-Z0-9_-]{1,64}$/;
  if (!nameRegex.test(name)) {
    showUploadError(
      "Invalid package name. Use only letters, numbers, underscores, and hyphens (1-64 chars).",
    );
    return;
  }

  // Validate version format
  const versionRegex = /^\d+\.\d+\.\d+$/;
  if (version && !versionRegex.test(version)) {
    showUploadError("Invalid version format. Use X.Y.Z (e.g., 1.0.0).");
    return;
  }

  // Validate Ko-fi URL format if provided
  if (kofiUrl) {
    const kofiUrlRegex = /^https?:\/\/(www\.)?ko-fi\.com\/[a-zA-Z0-9_]+\/?$/;
    if (!kofiUrlRegex.test(kofiUrl)) {
      showUploadError(
        "Invalid Ko-fi URL. Use format: https://ko-fi.com/username",
      );
      return;
    }
  }

  // Validate YouTube URL format if provided
  if (youtubeUrl) {
    const youtubeUrlRegex =
      /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[a-zA-Z0-9_-]+/;
    if (!youtubeUrlRegex.test(youtubeUrl)) {
      showUploadError("Invalid YouTube URL. Use a valid YouTube video URL.");
      return;
    }
  }

  // Validate Discord URL format if provided
  if (discordUrl) {
    const discordUrlRegex =
      /^https?:\/\/(www\.)?(discord\.(gg|com)\/|discordapp\.com\/invite\/)[a-zA-Z0-9_-]+/;
    if (!discordUrlRegex.test(discordUrl)) {
      showUploadError("Invalid Discord URL. Use a valid Discord invite link.");
      return;
    }
  }

  // Validate icon if provided
  if (iconInput.files && iconInput.files.length > 0) {
    const iconValidation = validateIcon(iconInput.files[0]);
    if (!iconValidation.valid) {
      showUploadError(iconValidation.error);
      return;
    }
  }

  // Validate file
  if (!fileInput.files || fileInput.files.length === 0) {
    showUploadError("Please select a .mcaddon file.");
    return;
  }

  const file = fileInput.files[0];
  const fileValidation = validateFile(file);
  if (!fileValidation.valid) {
    showUploadError(fileValidation.error);
    return;
  }

  // Disable button and show progress
  uploadBtn.disabled = true;
  uploadBtn.textContent = "Uploading...";
  progressDiv.style.display = "block";
  progressFill.style.width = "0%";
  progressText.textContent = "Reading file...";

  try {
    // Read file as base64
    progressText.textContent = "Encoding addon file...";
    progressFill.style.width = "15%";

    const fileBase64 = await readFileAsBase64(file);

    // Read icon as base64 if provided
    let iconBase64 = null;
    if (iconInput.files && iconInput.files.length > 0) {
      progressText.textContent = "Encoding icon...";
      progressFill.style.width = "30%";
      iconBase64 = await readFileAsBase64(iconInput.files[0]);
    }

    progressText.textContent = "Uploading to server...";
    progressFill.style.width = "50%";

    // Send upload request
    const requestBody = {
      name,
      description,
      version,
      fileBase64,
    };

    // Only include icon if provided
    if (iconBase64) {
      requestBody.iconBase64 = iconBase64;
    }

    // Only include Ko-fi URL if provided
    if (kofiUrl) {
      requestBody.kofiUrl = kofiUrl;
    }

    // Only include long description if provided
    if (longDescription) {
      requestBody.longDescription = longDescription;
    }

    // Only include category if provided
    if (category) {
      requestBody.category = category;
    }

    // Only include YouTube URL if provided
    if (youtubeUrl) {
      requestBody.youtubeUrl = youtubeUrl;
    }

    // Only include Discord URL if provided
    if (discordUrl) {
      requestBody.discordUrl = discordUrl;
    }

    const response = await fetch(`${API_URL}/packages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(requestBody),
    });

    progressFill.style.width = "90%";

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Upload failed");
    }

    progressFill.style.width = "100%";
    progressText.textContent = "Complete!";

    showUploadSuccess("Addon uploaded successfully! Refreshing packages...");

    // Clear saved form data on successful upload
    clearUploadFormData();

    // Refresh packages list after short delay
    setTimeout(async () => {
      await loadPackages();
      // Reset form after successful upload (don't just close, actually clear it)
      resetUploadForm();
      document.getElementById("uploadModal").style.display = "none";
    }, 1500);
  } catch (error) {
    console.error("Upload error:", error);
    showUploadError(
      error.message || "Failed to upload addon. Please try again.",
    );
    progressDiv.style.display = "none";
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = "Upload Addon";
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      // Result is a data URL like "data:application/octet-stream;base64,..."
      // We need just the base64 part
      const result = reader.result;
      if (typeof result === "string") {
        const base64 = result.split(",")[1];
        resolve(base64);
      } else {
        reject(new Error("Failed to read file"));
      }
    };

    reader.onerror = () => {
      reject(new Error("Failed to read file"));
    };

    reader.readAsDataURL(file);
  });
}

// Event delegation for edit buttons and support popups
document.addEventListener("click", function (event) {
  // Handle edit button clicks
  if (event.target.matches('[data-action="edit-package"]')) {
    const packageId = event.target.getAttribute("data-package-id");
    const packageName = event.target.getAttribute("data-package-name");
    openEditModal(parseInt(packageId), packageName);
  }

  // Handle support popup button clicks
  if (event.target.matches('[data-action="support-popup"]')) {
    const downloadUrl = event.target.getAttribute("data-download-url");
    const kofiUrl = event.target.getAttribute("data-kofi-url");
    const authorName = event.target.getAttribute("data-author-name");
    showSupportPopup(downloadUrl, kofiUrl, authorName);
  }
});

// Close modals when clicking outside
window.addEventListener("click", function (event) {
  const uploadModal = document.getElementById("uploadModal");
  if (event.target === uploadModal) {
    closeUploadModal();
  }
  const editModal = document.getElementById("editModal");
  if (event.target === editModal) {
    closeEditModal();
  }
});

// Edit Modal Functions
async function openEditModal(packageId, packageName) {
  if (!authToken) {
    openProfileModal();
    return;
  }

  try {
    const response = await fetch(
      `${API_URL}/packages/${encodeURIComponent(packageName)}/full`,
    );
    if (!response.ok) {
      console.error("Failed to fetch package:", response.status);
      return;
    }

    const result = await response.json();
    if (!result.success || !result.data) {
      console.error("Invalid package data:", result);
      return;
    }

    const pkg = result.data;

    const modal = document.getElementById("editModal");
    modal.style.display = "block";

    // Populate form fields - use textContent for safe setting
    document.getElementById("editPackageId").value = packageId;
    document.getElementById("editPackageOriginalName").value = pkg.name;
    document.getElementById("editName").value = pkg.name;
    document.getElementById("editDescription").value = pkg.description || "";
    document.getElementById("editVersion").value = pkg.version || "1.0.0";
    document.getElementById("editLongDescription").value =
      pkg.long_description || "";

    // Show current icon if exists
    const currentIconContainer = document.getElementById(
      "currentIconContainer",
    );
    const currentIconPreview = document.getElementById("currentIconPreview");
    if (pkg.icon_url) {
      currentIconPreview.src = pkg.icon_url;
      currentIconContainer.style.display = "block";
    } else {
      currentIconContainer.style.display = "none";
    }

    // Reset checkboxes and file inputs
    document.getElementById("updateIconCheckbox").checked = false;
    document.getElementById("updateFileCheckbox").checked = false;
    document.getElementById("editIconGroup").style.display = "none";
    document.getElementById("editFileGroup").style.display = "none";
    document.getElementById("editIcon").value = "";
    document.getElementById("editFile").value = "";
    document.getElementById("editSelectedIconName").textContent =
      "No icon selected";
    document
      .getElementById("editSelectedIconName")
      .classList.remove("has-file");
    document.getElementById("editSelectedFileName").textContent =
      "No file selected";
    document
      .getElementById("editSelectedFileName")
      .classList.remove("has-file");
    document.getElementById("editIconPreviewContainer").style.display = "none";

    // Handle Ko-fi URL
    const editKofiCheckbox = document.getElementById("editKofiCheckbox");
    const editKofiGroup = document.getElementById("editKofiGroup");
    const editKofiUrlEl = document.getElementById("editKofiUrl");
    if (pkg.kofi_url) {
      editKofiCheckbox.checked = true;
      editKofiGroup.style.display = "block";
      editKofiUrlEl.value = pkg.kofi_url;
    } else {
      editKofiCheckbox.checked = false;
      editKofiGroup.style.display = "none";
      editKofiUrlEl.value = "";
    }

    // Handle category, YouTube, and Discord
    document.getElementById("editCategory").value =
      (pkg.category ? pkg.category.slug : "") || "";
    document.getElementById("editYoutube").value = pkg.youtube_url || "";
    document.getElementById("editDiscord").value = pkg.discord_url || "";

    // Reset messages
    document.getElementById("editError").style.display = "none";
    document.getElementById("editSuccess").style.display = "none";
    document.getElementById("editProgress").style.display = "none";
    document.getElementById("editBtn").disabled = false;
    document.getElementById("editBtn").textContent = "Save Changes";
  } catch (error) {
    console.error("Error opening edit modal:", error);
  }
}

function closeEditModal() {
  const modal = document.getElementById("editModal");
  modal.style.display = "none";
  // Clear edit hash if present
  if (window.location.hash.startsWith("#edit-")) {
    window.location.hash = "";
  }
}

async function handleEditHash() {
  const hash = window.location.hash;
  if (!hash || !hash.startsWith("#edit-")) {
    return;
  }

  const packageName = decodeURIComponent(hash.substring(6)); // Remove '#edit-'
  if (!packageName) {
    return;
  }

  try {
    const response = await fetch(
      `${API_URL}/packages/${encodeURIComponent(packageName)}/full`,
    );
    if (!response.ok) {
      if (response.status === 404) {
        console.error("Package not found:", packageName);
      } else {
        console.error("Failed to fetch package:", response.status);
      }
      return;
    }

    const result = await response.json();
    if (!result.success || !result.data) {
      console.error("Invalid package data:", result);
      return;
    }

    const pkg = result.data;
    openEditModal(
      pkg.id,
      pkg.name,
      pkg.description,
      pkg.version,
      pkg.icon_url,
      pkg.kofi_url,
      pkg.long_description,
      pkg.category ? pkg.category.slug : null,
      pkg.youtube_url,
      pkg.discord_url,
    );
  } catch (error) {
    console.error("Error fetching package for edit:", error);
  }
}

function showEditError(message) {
  const errorDiv = document.getElementById("editError");
  errorDiv.textContent = message;
  errorDiv.style.display = "block";
  document.getElementById("editSuccess").style.display = "none";
}

function showEditSuccess(message) {
  const successDiv = document.getElementById("editSuccess");
  successDiv.textContent = message;
  successDiv.style.display = "block";
  document.getElementById("editError").style.display = "none";
}

async function handleUpdatePackage(event) {
  event.preventDefault();

  const packageId = document.getElementById("editPackageId").value;
  const name = document.getElementById("editName").value.trim();
  const description = document.getElementById("editDescription").value.trim();
  const longDescription = document
    .getElementById("editLongDescription")
    .value.trim();
  const version =
    document.getElementById("editVersion").value.trim() || "1.0.0";
  const updateIcon = document.getElementById("updateIconCheckbox").checked;
  const updateFile = document.getElementById("updateFileCheckbox").checked;
  const iconInput = document.getElementById("editIcon");
  const fileInput = document.getElementById("editFile");
  const editBtn = document.getElementById("editBtn");
  const progressDiv = document.getElementById("editProgress");
  const progressFill = document.getElementById("editProgressFill");
  const progressText = document.getElementById("editProgressText");
  const kofiCheckbox = document.getElementById("editKofiCheckbox");
  const kofiUrl = kofiCheckbox.checked
    ? document.getElementById("editKofiUrl").value.trim()
    : null;
  // Category, YouTube, and Discord
  const category = document.getElementById("editCategory").value;
  const youtubeUrl =
    document.getElementById("editYoutube").value.trim() || null;
  const discordUrl =
    document.getElementById("editDiscord").value.trim() || null;

  // Reset messages
  document.getElementById("editError").style.display = "none";
  document.getElementById("editSuccess").style.display = "none";

  // Validate name format
  const nameRegex = /^[a-zA-Z0-9_-]{1,64}$/;
  if (!nameRegex.test(name)) {
    showEditError(
      "Invalid package name. Use only letters, numbers, underscores, and hyphens (1-64 chars).",
    );
    return;
  }

  // Validate version format
  const versionRegex = /^\d+\.\d+\.\d+$/;
  if (version && !versionRegex.test(version)) {
    showEditError("Invalid version format. Use X.Y.Z (e.g., 1.0.0).");
    return;
  }

  // Validate Ko-fi URL format if provided
  if (kofiUrl) {
    const kofiUrlRegex = /^https?:\/\/(www\.)?ko-fi\.com\/[a-zA-Z0-9_]+\/?$/;
    if (!kofiUrlRegex.test(kofiUrl)) {
      showEditError(
        "Invalid Ko-fi URL. Use format: https://ko-fi.com/username",
      );
      return;
    }
  }

  // Validate YouTube URL format if provided
  if (youtubeUrl) {
    const youtubeUrlRegex =
      /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[a-zA-Z0-9_-]+/;
    if (!youtubeUrlRegex.test(youtubeUrl)) {
      showEditError("Invalid YouTube URL. Use a valid YouTube video URL.");
      return;
    }
  }

  // Validate Discord URL format if provided
  if (discordUrl) {
    const discordUrlRegex =
      /^https?:\/\/(www\.)?(discord\.(gg|com)\/|discordapp\.com\/invite\/)[a-zA-Z0-9_-]+/;
    if (!discordUrlRegex.test(discordUrl)) {
      showEditError("Invalid Discord URL. Use a valid Discord invite link.");
      return;
    }
  }

  // Validate icon if updating
  if (updateIcon && iconInput.files && iconInput.files.length > 0) {
    const iconValidation = validateIcon(iconInput.files[0]);
    if (!iconValidation.valid) {
      showEditError(iconValidation.error);
      return;
    }
  }

  // Validate file if updating
  if (updateFile && fileInput.files && fileInput.files.length > 0) {
    const fileValidation = validateFile(fileInput.files[0]);
    if (!fileValidation.valid) {
      showEditError(fileValidation.error);
      return;
    }
  }

  // Disable button and show progress
  editBtn.disabled = true;
  editBtn.textContent = "Saving...";
  progressDiv.style.display = "block";
  progressFill.style.width = "0%";
  progressText.textContent = "Preparing update...";

  try {
    // Build the request body
    const requestBody = {
      name,
      description,
      version,
      kofiUrl: kofiUrl, // Can be null to remove, or a URL to set
      longDescription: longDescription || null, // Can be null to remove, or text to set
      category: category || null, // Can be null to clear, or slug to set
      youtubeUrl: youtubeUrl, // Can be null to remove
      discordUrl: discordUrl, // Can be null to remove
    };

    progressFill.style.width = "20%";

    // Encode icon if updating
    if (updateIcon && iconInput.files && iconInput.files.length > 0) {
      progressText.textContent = "Encoding icon...";
      requestBody.iconBase64 = await readFileAsBase64(iconInput.files[0]);
    }

    progressFill.style.width = "40%";

    // Encode file if updating
    if (updateFile && fileInput.files && fileInput.files.length > 0) {
      progressText.textContent = "Encoding addon file...";
      requestBody.fileBase64 = await readFileAsBase64(fileInput.files[0]);
    }

    progressFill.style.width = "60%";
    progressText.textContent = "Sending update...";

    const response = await fetch(`${API_URL}/packages/${packageId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(requestBody),
    });

    progressFill.style.width = "90%";

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Update failed");
    }

    progressFill.style.width = "100%";
    progressText.textContent = "Complete!";

    showEditSuccess("Package updated successfully! Refreshing...");

    // Refresh packages list after short delay
    setTimeout(async () => {
      await loadPackages();
      closeEditModal();
    }, 1500);
  } catch (error) {
    console.error("Update error:", error);
    showEditError(
      error.message || "Failed to update package. Please try again.",
    );
    progressDiv.style.display = "none";
  } finally {
    editBtn.disabled = false;
    editBtn.textContent = "Save Changes";
  }
}

async function handleDeletePackage() {
  const packageId = document.getElementById("editPackageId").value;
  const packageName = document.getElementById("editPackageOriginalName").value;

  // Confirm deletion
  const confirmed = confirm(
    `Are you sure you want to delete "${packageName}"? This action cannot be undone.`,
  );
  if (!confirmed) {
    return;
  }

  // Double confirm for safety
  const doubleConfirm = confirm(
    `Final confirmation: Delete "${packageName}" permanently?`,
  );
  if (!doubleConfirm) {
    return;
  }

  try {
    const response = await fetch(`${API_URL}/packages/${packageId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Delete failed");
    }

    showEditSuccess("Package deleted successfully!");

    // Refresh packages list after short delay
    setTimeout(async () => {
      await loadPackages();
      closeEditModal();
    }, 1500);
  } catch (error) {
    console.error("Delete error:", error);
    showEditError(
      error.message || "Failed to delete package. Please try again.",
    );
  }
}

function handleIconError(imgElement) {
  imgElement.style.display = "none";
  const parent = imgElement.parentElement;
  if (!parent.querySelector("span")) {
    const fallback = document.createElement("span");
    fallback.style.fontSize = "48px";
    fallback.style.color = "#555";
    fallback.textContent = "📦";
    parent.appendChild(fallback);
  }
}

function setupEventListeners() {
  document
    .getElementById("search")
    .addEventListener("input", debounce(applyFilters, 300));
  document
    .getElementById("author")
    .addEventListener("input", debounce(applyFilters, 300));
  document
    .getElementById("categoryFilter")
    .addEventListener("change", applyFilters);
  document.getElementById("sortBy").addEventListener("change", applyFilters);

  // Check for category parameter in URL
  const urlParams = new URLSearchParams(window.location.search);
  const categoryParam = urlParams.get("category");
  if (categoryParam) {
    document.getElementById("categoryFilter").value = categoryParam;
  }
  const authorParam = urlParams.get("author");
  if (authorParam) {
    document.getElementById("author").value = authorParam;
  }
}

function debounce(func, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
}

async function getAuthorName(authorId) {
  if (authorCache[authorId]) {
    return authorCache[authorId];
  }

  try {
    const response = await fetch(`${API_URL}/user/id/${authorId}`);
    if (response.ok) {
      const data = await response.json();
      authorCache[authorId] = data.username || "Author " + authorId;
    } else {
      authorCache[authorId] = "Author " + authorId;
    }
  } catch (e) {
    authorCache[authorId] = "Author " + authorId;
  }

  return authorCache[authorId];
}

async function loadPackages() {
  try {
    const container = document.getElementById("packagesContainer");
    container.innerHTML =
      '<div class="loading"><div class="spinner"></div></div>';

    // Reset pagination state
    currentPage = 1;
    totalPages = 0;
    totalPackages = 0;

    // Load first page to get total count
    await fetchAndRenderPage(1);
  } catch (error) {
    showMessage("Error loading packages: " + error.message, "error");
    document.getElementById("packagesContainer").innerHTML = "";
  }
}

async function fetchAndRenderPage(page) {
  try {
    const container = document.getElementById("packagesContainer");

    const searchTerm = document.getElementById("search").value.toLowerCase();
    const authorTerm = document.getElementById("author").value.toLowerCase();
    const categoryFilter = document.getElementById("categoryFilter").value;
    sortBy = document.getElementById("sortBy").value;

    // Build query parameters
    const params = new URLSearchParams();
    params.append("limit", pageSize);
    params.append("offset", (page - 1) * pageSize);

    // Add server-side filters
    if (categoryFilter && categoryFilter.length > 0) {
      params.append("category", categoryFilter);
    }

    const response = await fetch(`${API_URL}/packages?${params.toString()}`);

    if (!response.ok) {
      throw new Error("Failed to load packages");
    }

    const data = await response.json();
    const packages = data.data || [];
    totalPackages = data.total || 0;
    totalPages = Math.ceil(totalPackages / pageSize);
    currentPage = page;

    // Filter packages on client side (search and author filters)
    let filteredPackages = packages.filter((pkg) => {
      const matchesSearch =
        (pkg.name && pkg.name.toLowerCase().includes(searchTerm)) ||
        (pkg.description && pkg.description.toLowerCase().includes(searchTerm));

      let matchesAuthor = true;
      if (authorTerm) {
        const authorName = authorCache[pkg.author_id] || "";
        matchesAuthor = authorName.toLowerCase().includes(authorTerm);
      }

      return matchesSearch && matchesAuthor;
    });

    // Apply sorting
    filteredPackages = sortPackages(filteredPackages, sortBy);

    // Update counts
    document.getElementById("totalCount").textContent = filteredPackages.length;
    document.getElementById("displayCount").textContent = filteredPackages.length;

    // Render packages
    const packagesHtml = await renderPackagesHtml(filteredPackages);
    container.innerHTML = packagesHtml || `
      <div class="empty-state">
        <p>No packages found</p>
        <p style="font-size: 12px; color: #555;">Try adjusting your filters</p>
      </div>
    `;

    renderServerPagination();
    updateURLParams();
  } catch (error) {
    showMessage("Error loading packages: " + error.message, "error");
  }
}

async function renderPackagesHtml(packages) {
  if (packages.length === 0) {
    return null;
  }

   let html = "";
   for (const pkg of packages) {
     const authorName = await getAuthorName(pkg.author_id);
     const iconHtml = pkg.icon_url
       ? `<img src="${escapeHtml(pkg.icon_url)}" alt="${escapeHtml(pkg.name)} icon" loading="lazy" onerror="handleIconError(this)">`
       : `<span style="font-size: 48px; color: #555;">📦</span>`;

    // Check if current user owns this package
    const isOwner =
      currentUserId && Number(pkg.author_id) === Number(currentUserId);

    // Download button - if Ko-fi URL exists, show support popup first
    const downloadUrl = `${API_URL}/packages/${encodeURIComponent(pkg.name)}/download`;
    const downloadButtonHtml = pkg.kofi_url
      ? `<button class="download-btn" data-action="support-popup" data-download-url="${escapeHtml(downloadUrl)}" data-kofi-url="${escapeHtml(pkg.kofi_url)}" data-author-name="${escapeHtml(authorName)}">
                    Download
                   </button>`
      : `<a href="${downloadUrl}" class="download-btn" download>
                    Download
                   </a>`;

     // View Details button - link to dedicated package page
     const viewDetailsBtn = `<a href="/package/${encodeURIComponent(pkg.name)}" class="view-details-btn">View Details</a>`;

     const actionsHtml = isOwner
       ? `<div class="package-actions">
                    ${viewDetailsBtn}
                    ${downloadButtonHtml}
                    <button class="edit-btn" data-action="edit-package" data-package-id="${pkg.id}" data-package-name="${escapeHtml(pkg.name)}">
                      Edit
                    </button>
                  </div>`
       : `<div class="package-actions">
                  ${viewDetailsBtn}
                  ${downloadButtonHtml}
                </div>`;

     // Generate category HTML (single category instead of multiple tags)
     const categorySlug = pkg.tag_slug || (pkg.category && pkg.category.slug);
     const categoryName = pkg.tag_name || (pkg.category && pkg.category.name);
     const categoryHtml = categorySlug
       ? `<div class="package-category">
                    <a href="/packages.html?category=${encodeURIComponent(categorySlug)}" class="category-badge">${escapeHtml(categoryName)}</a>
                </div>`
       : "";

     // Add loading="lazy" to icon images
     const iconWithLazy = iconHtml.replace(/<img\s/g, '<img loading="lazy" ');

     html += `
 <div class="package-card">
  <div class="package-icon">
    ${iconWithLazy}
  </div>
  <h3>${escapeHtml(pkg.name)}</h3>
  <div class="package-meta">
    <span>Downloads: ${pkg.downloads || 0}</span>
    <span>Date: ${formatDate(pkg.created_at)}</span>
  </div>
  ${categoryHtml}
  <p class="package-description">${escapeHtml(pkg.description || "No description provided")}</p>
  <span class="package-version">Version ${pkg.version || "1.0.0"}</span>
  <p class="package-author">By: ${escapeHtml(authorName)}</p>
  ${actionsHtml}
 </div>
 `;
  }
  return html;
}

async function applyFilters() {
  currentPage = 1;
  await fetchAndRenderPage(1);
}

function updateURLParams() {
  const searchTerm = document.getElementById("search").value.trim();
  const authorTerm = document.getElementById("author").value.trim();
  const categoryFilterValue = document.getElementById("categoryFilter").value;

  const url = new URL(window.location);

  if (categoryFilterValue) {
    url.searchParams.set("category", categoryFilterValue);
  } else {
    url.searchParams.delete("category");
  }

  if (authorTerm) {
    url.searchParams.set("author", authorTerm);
  } else {
    url.searchParams.delete("author");
  }

  if (searchTerm) {
    url.searchParams.set("search", searchTerm);
  } else {
    url.searchParams.delete("search");
  }

  window.history.replaceState({}, "", url);
}

function sortPackages(packages, sortType) {
  const sorted = [...packages];

  switch (sortType) {
    case "oldest":
      sorted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      break;
    case "downloads":
      sorted.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
      break;
    case "name":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "newest":
    default:
      sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      break;
  }

  return sorted;
}

function renderServerPagination() {
  const container = document.getElementById("pagination");

  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  let html = "";

  html += `<button onclick="goToServerPage(${currentPage - 1})" ${currentPage === 1 ? "disabled" : ""}>Previous</button>`;

  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, currentPage + 2);

  if (startPage > 1) {
    html += `<button onclick="goToServerPage(1)">1</button>`;
    if (startPage > 2) {
      html += `<span>...</span>`;
    }
  }

  for (let i = startPage; i <= endPage; i++) {
    html += `<button onclick="goToServerPage(${i})" class="${i === currentPage ? "active" : ""}">${i}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      html += `<span>...</span>`;
    }
    html += `<button onclick="goToServerPage(${totalPages})">${totalPages}</button>`;
  }

  html += `<button onclick="goToServerPage(${currentPage + 1})" ${currentPage === totalPages ? "disabled" : ""}>Next</button>`;

  container.innerHTML = html;
}

function goToServerPage(page) {
  if (page >= 1 && page <= totalPages) {
    fetchAndRenderPage(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function changePageSize(size) {
  pageSize = size;
  currentPage = 1;

  document.querySelectorAll(".sort-btn").forEach((btn) => {
    btn.classList.remove("active");
  });
  event.target.classList.add("active");

  applyFilters();
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

function showMessage(message, type) {
  const container = document.getElementById("messageContainer");
  container.innerHTML = `<div class="${type}">${message}</div>`;
  setTimeout(() => {
    container.innerHTML = "";
  }, 5000);
}

// Support Popup Functions
let supportPopupTimer = null;
let pendingDownloadUrl = null;

function showSupportPopup(downloadUrl, kofiUrl, authorName) {
  pendingDownloadUrl = downloadUrl;

  // Set the author name and Ko-fi link
  document.getElementById("supportAuthorName").textContent = authorName;
  document.getElementById("supportKofiBtn").href = kofiUrl;

  // Reset and show popup
  const popup = document.getElementById("supportPopup");
  const skipBtn = document.getElementById("supportSkipBtn");
  const timerSpan = document.getElementById("supportTimer");

  popup.style.display = "block";
  skipBtn.disabled = true;

  // Start countdown
  let countdown = 3;
  timerSpan.textContent = countdown;

  supportPopupTimer = setInterval(() => {
    countdown--;
    if (countdown > 0) {
      timerSpan.textContent = countdown;
    } else {
      clearInterval(supportPopupTimer);
      supportPopupTimer = null;
      skipBtn.disabled = false;
      skipBtn.innerHTML = "No thanks, just download";
    }
  }, 1000);
}

function closeSupportPopup() {
  const popup = document.getElementById("supportPopup");
  popup.style.display = "none";

  if (supportPopupTimer) {
    clearInterval(supportPopupTimer);
    supportPopupTimer = null;
  }

  // Reset button state for next time
  const skipBtn = document.getElementById("supportSkipBtn");
  const timerSpan = document.getElementById("supportTimer");
  skipBtn.disabled = true;
  timerSpan.textContent = "3";
  skipBtn.innerHTML =
    'No thanks, just download (<span class="support-popup-timer" id="supportTimer">3</span>)';
}

function skipAndDownload() {
  if (pendingDownloadUrl) {
    // Trigger download
    window.location.href = pendingDownloadUrl;
  }
  closeSupportPopup();
}

// Close popup when clicking outside
document
  .getElementById("supportPopup")
  .addEventListener("click", function (event) {
    if (event.target === this) {
      // Don't close on outside click - user must choose an option
    }
  });

// Skip button click handler
document
  .getElementById("supportSkipBtn")
  .addEventListener("click", skipAndDownload);

// Ko-fi button click handler - also close popup and trigger download
document
  .getElementById("supportKofiBtn")
  .addEventListener("click", function () {
    // Small delay to let the Ko-fi page open, then trigger download
    setTimeout(() => {
      if (pendingDownloadUrl) {
        window.location.href = pendingDownloadUrl;
      }
      closeSupportPopup();
    }, 500);
  });
