const API_URL = '';
let authToken = null;
let currentUsername = null;
let turnstileToken = null;
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
        document.querySelectorAll('.cf-turnstile').forEach(el => {
          el.style.display = 'none';
        });
      }
    }
  } catch (e) {
    console.error("Failed to fetch config:", e);
  }
}

// Turnstile callbacks
function onTurnstileSuccess(token) {
  turnstileToken = token;
}

function onTurnstileExpired() {
  turnstileToken = null;
}

// Pagination and filter state
const paginationState = {
  users: {
    currentPage: 1,
    itemsPerPage: 10,
    totalItems: 0,
    totalPages: 0
  },
  packages: {
    currentPage: 1,
    itemsPerPage: 10,
    totalItems: 0,
    totalPages: 0
  }
};

// Store all data for filtering
let allUsers = [];
let allPackages = [];
let authorCache = {};

// Debounce helper
function debounce(func, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
}

 window.addEventListener('DOMContentLoaded', async () => {
   await fetchConfig();
   
   const savedToken = localStorage.getItem('authToken');
   const savedUsername = localStorage.getItem('username');
   
   if (savedToken && savedUsername) {
     authToken = savedToken;
     currentUsername = savedUsername;
     showDashboard();
     setupEventListeners();
     loadUsers();
     loadPackages();
   }
 });

 function setupEventListeners() {
   // User search and filter
   document.getElementById('userSearch').addEventListener('input', debounce(applyUserFilters, 300));
   document.getElementById('userRoleFilter').addEventListener('change', applyUserFilters);
   
   // Package search and filter
   document.getElementById('packageSearch').addEventListener('input', debounce(applyPackageFilters, 300));
   document.getElementById('packageAuthorFilter').addEventListener('input', debounce(applyPackageFilters, 300));
   document.getElementById('packageSortBy').addEventListener('change', applyPackageFilters);
 }

async function handleLogin(event) {
  event.preventDefault();
  
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const loginBtn = document.getElementById('loginBtn');
  const errorDiv = document.getElementById('loginError');
  
  errorDiv.style.display = 'none';

  // Check if Turnstile token is available (skip in dev mode)
  if (!devMode && !turnstileToken) {
    errorDiv.textContent = 'Please complete the CAPTCHA verification';
    errorDiv.style.display = 'block';
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = 'Logging in...';
  
  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password, turnstileToken: devMode ? "dev-mode" : turnstileToken }),
    });
    
    const data = await response.json();
    
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Login failed');
    }
    
    authToken = data.token;
    currentUsername = data.user.username;
    localStorage.setItem('authToken', authToken);
    localStorage.setItem('username', currentUsername);
    
    showDashboard();
    loadUsers();
    loadPackages();
  } catch (error) {
    errorDiv.textContent = error.message;
    errorDiv.style.display = 'block';
    // Reset Turnstile widget on error
    turnstileToken = null;
    if (typeof turnstile !== 'undefined') {
      turnstile.reset();
    }
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Login';
  }
}

function showDashboard() {
 document.getElementById('loginForm').style.display = 'none';
 document.getElementById('dashboard').style.display = 'block';
 document.getElementById('currentUser').textContent = currentUsername;
}

function handleLogout() {
 authToken = null;
 currentUsername = null;
 localStorage.removeItem('authToken');
 localStorage.removeItem('username');

 document.getElementById('username').value = '';
 document.getElementById('password').value = '';
 document.getElementById('loginForm').style.display = 'block';
 document.getElementById('dashboard').style.display = 'none';
}

async function loadUsers(page = 1) {
  const container = document.getElementById('usersContainer');
  const paginationContainer = document.getElementById('usersPagination');
  const loading = document.getElementById('usersLoading');

  try {
    loading.style.display = 'block';
    container.innerHTML = '';
    paginationContainer.style.display = 'none';

    const response = await fetch(`${API_URL}/admin/users`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

     const data = await response.json();
     
     if (!response.ok) {
       throw new Error(data.error || 'Failed to load users');
     }
    allUsers = data.users || [];

    document.getElementById('totalUsers').textContent = allUsers.length;
    document.getElementById('totalDevelopers').textContent = allUsers.filter(u => u.role === 'developer').length;

    // Apply filters and render
    applyUserFilters();
  } catch (error) {
    document.getElementById('usersContainer').innerHTML = `<div class="error" style="display: block;">${error.message}</div>`;
  } finally {
    loading.style.display = 'none';
  }
}

function applyUserFilters() {
  const searchTerm = document.getElementById('userSearch').value.toLowerCase();
  const roleFilter = document.getElementById('userRoleFilter').value;
  
  paginationState.users.currentPage = 1;

  let filteredUsers = allUsers.filter(user => {
    const matchesSearch = 
      user.username.toLowerCase().includes(searchTerm) ||
      user.email.toLowerCase().includes(searchTerm);
    
    const matchesRole = !roleFilter || user.role === roleFilter;

    return matchesSearch && matchesRole;
  });

  paginationState.users.totalItems = filteredUsers.length;
  paginationState.users.totalPages = Math.ceil(filteredUsers.length / paginationState.users.itemsPerPage);

  renderFilteredUsers(filteredUsers, 1);
}

function renderFilteredUsers(filteredUsers, page) {
  const container = document.getElementById('usersContainer');
  const paginationContainer = document.getElementById('usersPagination');

  if (filteredUsers.length === 0) {
    container.innerHTML = '<p style="color: #888; text-align: center;">No users found</p>';
    paginationContainer.style.display = 'none';
    return;
  }

  paginationState.users.currentPage = Math.max(1, Math.min(page, paginationState.users.totalPages));
  
  // Paginate users
  const start = (paginationState.users.currentPage - 1) * paginationState.users.itemsPerPage;
  const end = start + paginationState.users.itemsPerPage;
  const paginatedUsers = filteredUsers.slice(start, end);

   let tableHTML = `
     <div class="table-wrapper">
       <table class="user-table">
         <thead>
           <tr>
             <th>ID</th>
             <th>Username</th>
             <th>Email</th>
             <th>Current Role</th>
             <th>New Role</th>
             <th>Actions</th>
           </tr>
         </thead>
         <tbody>
   `;

   paginatedUsers.forEach(user => {
     tableHTML += `
       <tr>
         <td>${user.id}</td>
         <td>${escapeHtml(user.username)}</td>
         <td>${escapeHtml(user.email)}</td>
         <td><strong>${user.role}</strong></td>
         <td>
           <select class="role-select" id="role-${user.id}">
             <option value="user" ${user.role === 'user' ? 'selected' : ''}>user</option>
             <option value="developer" ${user.role === 'developer' ? 'selected' : ''}>developer</option>
             <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>admin</option>
           </select>
         </td>
         <td style="display: flex; gap: 5px;">
           <button class="update-role-btn" onclick="updateUserRole(${user.id})">Role</button>
           <button class="edit-btn" data-action="edit-user" data-user-id="${user.id}" data-user-username="${escapeHtml(user.username)}" data-user-email="${escapeHtml(user.email)}" title="Edit">Edit</button>
           <button class="delete-btn" data-action="delete-user" data-user-id="${user.id}" data-user-username="${escapeHtml(user.username)}" title="Delete">Delete</button>
         </td>
       </tr>
     `;
   });

   tableHTML += `
         </tbody>
       </table>
     </div>
   `;

  container.innerHTML = tableHTML;

  // Render pagination controls if more than one page
  if (paginationState.users.totalPages > 1) {
    renderUserPagination(filteredUsers);
    paginationContainer.style.display = 'flex';
  }
}

function renderUserPagination(filteredUsers) {
  const container = document.getElementById('usersPagination');
  const state = paginationState.users;
  let html = '';

  // Previous button
  html += `<button onclick="renderFilteredUsers(getAllFilteredUsers(), ${state.currentPage - 1})" ${state.currentPage === 1 ? 'disabled' : ''}>← Previous</button>`;

  // Page numbers
  const maxVisiblePages = 5;
  let startPage = Math.max(1, state.currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(state.totalPages, startPage + maxVisiblePages - 1);

  if (endPage - startPage < maxVisiblePages - 1) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }

  if (startPage > 1) {
    html += `<button onclick="renderFilteredUsers(getAllFilteredUsers(), 1)">1</button>`;
    if (startPage > 2) html += `<span class="pagination-info">...</span>`;
  }

  for (let i = startPage; i <= endPage; i++) {
    html += `<button onclick="renderFilteredUsers(getAllFilteredUsers(), ${i})" class="${i === state.currentPage ? 'active' : ''}">${i}</button>`;
  }

  if (endPage < state.totalPages) {
    if (endPage < state.totalPages - 1) html += `<span class="pagination-info">...</span>`;
    html += `<button onclick="renderFilteredUsers(getAllFilteredUsers(), ${state.totalPages})">${state.totalPages}</button>`;
  }

  // Next button
  html += `<button onclick="renderFilteredUsers(getAllFilteredUsers(), ${state.currentPage + 1})" ${state.currentPage === state.totalPages ? 'disabled' : ''}>Next →</button>`;

  // Page info
  html += `<span class="pagination-info">Page ${state.currentPage} of ${state.totalPages}</span>`;

  container.innerHTML = html;
}

function getAllFilteredUsers() {
  const searchTerm = document.getElementById('userSearch').value.toLowerCase();
  const roleFilter = document.getElementById('userRoleFilter').value;

  return allUsers.filter(user => {
    const matchesSearch = 
      user.username.toLowerCase().includes(searchTerm) ||
      user.email.toLowerCase().includes(searchTerm);
    
    const matchesRole = !roleFilter || user.role === roleFilter;

    return matchesSearch && matchesRole;
  });
}

async function getAuthorName(authorId) {
  if (authorCache[authorId]) {
    return authorCache[authorId];
  }
  
  try {
    const response = await fetch(`${API_URL}/user/id/${authorId}`);
    if (response.ok) {
      const data = await response.json();
      authorCache[authorId] = data.username || ('Author ' + authorId);
    } else {
      authorCache[authorId] = 'Author ' + authorId;
    }
  } catch (e) {
    authorCache[authorId] = 'Author ' + authorId;
  }
  
  return authorCache[authorId];
}

async function updateUserRole(userId) {
 const newRole = document.getElementById(`role-${userId}`).value;
 const successDiv = document.getElementById('successMsg');
 const btn = event.target;

 btn.disabled = true;
 btn.textContent = 'Updating...';

 try {
   const response = await fetch(`${API_URL}/admin/users/${userId}/role`, {
     method: 'PUT',
     headers: {
       'Content-Type': 'application/json',
       'Authorization': `Bearer ${authToken}`,
     },
     body: JSON.stringify({ role: newRole }),
   });

   const data = await response.json();

   if (!response.ok || !data.success) {
     throw new Error(data.error || 'Failed to update role');
   }

   successDiv.textContent = 'Role updated successfully for ' + data.user.username;
   successDiv.style.display = 'block';

   setTimeout(() => {
     successDiv.style.display = 'none';
   }, 3000);

   loadUsers();
 } catch (error) {
   alert('Error: ' + error.message);
   btn.disabled = false;
   btn.textContent = 'Update';
  }
}

 let packageToEdit = null;
 let packageToDelete = null;

 async function loadPackages(page = 1) {
   const container = document.getElementById('packagesContainer');
   const paginationContainer = document.getElementById('packagesPagination');
   const loading = document.getElementById('packagesLoading');

   try {
     loading.style.display = 'block';
     container.innerHTML = '';
     paginationContainer.style.display = 'none';

     let allPackagesList = [];
     let offset = 0;
     const limit = 100;

     while (true) {
       const response = await fetch(
         `${API_URL}/packages?limit=${limit}&offset=${offset}`
       );

       const data = await response.json();
       
       if (!response.ok) {
         throw new Error(data.error || 'Failed to load packages');
       }
       const packages = data.data || [];

       if (packages.length === 0) {
         break;
       }

       allPackagesList = allPackagesList.concat(packages);
       offset += limit;
     }

     // Fetch full data with category for each package
     const packagesWithCategory = await Promise.all(
       allPackagesList.map(async (pkg) => {
         try {
           const fullResp = await fetch(
             `${API_URL}/packages/${encodeURIComponent(pkg.name)}/full`
           );
           if (fullResp.ok) {
             const fullData = await fullResp.json();
             if (fullData.success && fullData.data) {
               return {
                 ...pkg,
                 category: fullData.data.category || null,
               };
             }
           }
         } catch (e) {
           console.error("Failed to fetch category for", pkg.name);
         }
         return { ...pkg, category: null };
       })
     );

     allPackages = packagesWithCategory;
     document.getElementById('totalPackages').textContent = allPackagesList.length;

     // Pre-load author names for all packages
     const uniqueAuthorIds = [...new Set(allPackagesList.map(p => p.author_id))];
     for (const authorId of uniqueAuthorIds) {
       await getAuthorName(authorId);
     }

     // Apply filters and render
     applyPackageFilters();
   } catch (error) {
     document.getElementById('packagesContainer').innerHTML = `<div class="error" style="display: block;">${error.message}</div>`;
   } finally {
     loading.style.display = 'none';
   }
 }

 async function applyPackageFilters() {
   const searchTerm = document.getElementById('packageSearch').value.toLowerCase();
   const authorTerm = document.getElementById('packageAuthorFilter').value.toLowerCase();
   const sortBy = document.getElementById('packageSortBy').value;
   
   paginationState.packages.currentPage = 1;

   let filteredPackages = allPackages.filter(pkg => {
     const matchesSearch = 
       pkg.name.toLowerCase().includes(searchTerm) ||
       (pkg.description && pkg.description.toLowerCase().includes(searchTerm));
     
     let matchesAuthor = true;
     if (authorTerm) {
       const authorName = authorCache[pkg.author_id];
       matchesAuthor = authorName && authorName.toLowerCase().includes(authorTerm);
     }

     return matchesSearch && matchesAuthor;
   });

   // Sort packages
   filteredPackages = sortPackages(filteredPackages, sortBy);

   paginationState.packages.totalItems = filteredPackages.length;
   paginationState.packages.totalPages = Math.ceil(filteredPackages.length / paginationState.packages.itemsPerPage);

   await renderFilteredPackages(filteredPackages, 1);
 }

 function sortPackages(packages, sortType) {
   const sorted = [...packages];

   switch (sortType) {
     case 'oldest':
       sorted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
       break;
     case 'downloads':
       sorted.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
       break;
     case 'name':
       sorted.sort((a, b) => a.name.localeCompare(b.name));
       break;
     case 'newest':
     default:
       sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
       break;
   }

   return sorted;
 }

 async function renderFilteredPackages(filteredPackages, page) {
   const container = document.getElementById('packagesContainer');
   const paginationContainer = document.getElementById('packagesPagination');

   if (filteredPackages.length === 0) {
     container.innerHTML = '<p style="color: #888; text-align: center;">No packages found</p>';
     paginationContainer.style.display = 'none';
     return;
   }

   paginationState.packages.currentPage = Math.max(1, Math.min(page, paginationState.packages.totalPages));
   
   // Paginate packages
   const start = (paginationState.packages.currentPage - 1) * paginationState.packages.itemsPerPage;
   const end = start + paginationState.packages.itemsPerPage;
   const paginatedPackages = filteredPackages.slice(start, end);

   let tableHTML = `
     <div class="table-wrapper">
       <table class="user-table">
         <thead>
           <tr>
             <th>Icon</th>
             <th>ID</th>
             <th>Name</th>
             <th>Author</th>
             <th>Category</th>
             <th>Version</th>
             <th>Downloads</th>
             <th>Ko-fi</th>
             <th>Created At</th>
             <th>Actions</th>
           </tr>
         </thead>
         <tbody>
   `;

   for (const pkg of paginatedPackages) {
     const createdDate = new Date(pkg.created_at).toLocaleDateString('en-US', {
       year: 'numeric',
       month: 'short',
       day: 'numeric'
     });

     const authorName = await getAuthorName(pkg.author_id);
     const iconHtml = pkg.icon_url 
       ? `<img src="${escapeHtml(pkg.icon_url)}" alt="icon" class="package-icon-thumb" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline'"><span style="display:none; color:#555;">-</span>` 
       : `<span style="color:#555;">-</span>`;
     const kofiHtml = pkg.kofi_url
       ? `<a href="${escapeHtml(pkg.kofi_url)}" target="_blank" rel="noopener" style="color: #ff5e5b; text-decoration: none;" title="${escapeHtml(pkg.kofi_url)}">Yes</a>`
       : `<span style="color:#555;">-</span>`;
     const categoryHtml = pkg.category
       ? `<span style="color: #c4a574;">${escapeHtml(pkg.category.name)}</span>`
       : `<span style="color:#555;">-</span>`;
     const categorySlug = pkg.category ? pkg.category.slug : '';

      tableHTML += `
        <tr>
          <td class="icon-cell">${iconHtml}</td>
          <td>${pkg.id}</td>
          <td><strong>${escapeHtml(pkg.name)}</strong></td>
          <td>${escapeHtml(authorName)}</td>
          <td>${categoryHtml}</td>
          <td>${pkg.version || '1.0.0'}</td>
          <td>${pkg.downloads || 0}</td>
          <td>${kofiHtml}</td>
          <td>${createdDate}</td>
           <td>
             <button class="edit-btn" data-action="edit-package" data-package-id="${pkg.id}" data-package-name="${escapeHtml(pkg.name)}" title="Edit">Edit</button>
             <button class="delete-btn" data-action="delete-package" data-package-id="${pkg.id}" data-package-name="${escapeHtml(pkg.name)}" title="Delete">Delete</button>
           </td>
        </tr>
      `;
   }

   tableHTML += `
         </tbody>
       </table>
     </div>
   `;

   container.innerHTML = tableHTML;

   // Render pagination controls if more than one page
   if (paginationState.packages.totalPages > 1) {
     renderPackagesPagination(filteredPackages);
     paginationContainer.style.display = 'flex';
   }
 }

 function renderPackagesPagination(filteredPackages) {
   const container = document.getElementById('packagesPagination');
   const state = paginationState.packages;
   let html = '';

   // Previous button
   html += `<button onclick="renderFilteredPackages(getAllFilteredPackages(), ${state.currentPage - 1})" ${state.currentPage === 1 ? 'disabled' : ''}>← Previous</button>`;

   // Page numbers
   const maxVisiblePages = 5;
   let startPage = Math.max(1, state.currentPage - Math.floor(maxVisiblePages / 2));
   let endPage = Math.min(state.totalPages, startPage + maxVisiblePages - 1);

   if (endPage - startPage < maxVisiblePages - 1) {
     startPage = Math.max(1, endPage - maxVisiblePages + 1);
   }

   if (startPage > 1) {
     html += `<button onclick="renderFilteredPackages(getAllFilteredPackages(), 1)">1</button>`;
     if (startPage > 2) html += `<span class="pagination-info">...</span>`;
   }

   for (let i = startPage; i <= endPage; i++) {
     html += `<button onclick="renderFilteredPackages(getAllFilteredPackages(), ${i})" class="${i === state.currentPage ? 'active' : ''}">${i}</button>`;
   }

   if (endPage < state.totalPages) {
     if (endPage < state.totalPages - 1) html += `<span class="pagination-info">...</span>`;
     html += `<button onclick="renderFilteredPackages(getAllFilteredPackages(), ${state.totalPages})">${state.totalPages}</button>`;
   }

   // Next button
   html += `<button onclick="renderFilteredPackages(getAllFilteredPackages(), ${state.currentPage + 1})" ${state.currentPage === state.totalPages ? 'disabled' : ''}>Next →</button>`;

   // Page info
   html += `<span class="pagination-info">Page ${state.currentPage} of ${state.totalPages}</span>`;

   container.innerHTML = html;
 }

 function getAllFilteredPackages() {
   const searchTerm = document.getElementById('packageSearch').value.toLowerCase();
   const authorTerm = document.getElementById('packageAuthorFilter').value.toLowerCase();
   const sortBy = document.getElementById('packageSortBy').value;

   let filteredPackages = allPackages.filter(pkg => {
     const matchesSearch = 
       pkg.name.toLowerCase().includes(searchTerm) ||
       (pkg.description && pkg.description.toLowerCase().includes(searchTerm));
     
     let matchesAuthor = true;
     if (authorTerm) {
       const authorName = authorCache[pkg.author_id];
       matchesAuthor = authorName && authorName.toLowerCase().includes(authorTerm);
     }

     return matchesSearch && matchesAuthor;
   });

   return sortPackages(filteredPackages, sortBy);
 }

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

 async function openEditModal(packageId, packageName) {
   try {
     const response = await fetch(`${API_URL}/packages/${encodeURIComponent(packageName)}/full`);
     if (!response.ok) {
       console.error('Failed to fetch package:', response.status);
       return;
     }
     
     const result = await response.json();
     if (!result.success || !result.data) {
       console.error('Invalid package data:', result);
       return;
     }
     
     const pkg = result.data;
     packageToEdit = { id: packageId, name: pkg.name };
     document.getElementById('editPackageName').value = pkg.name;
     document.getElementById('editPackageDescription').value = pkg.description || '';
     document.getElementById('editPackageVersion').value = pkg.version || '';
     document.getElementById('editPackageIcon').value = pkg.icon_url || '';
     document.getElementById('editPackageKofi').value = pkg.kofi_url || '';
     document.getElementById('editPackageYoutube').value = pkg.youtube_url || '';
     document.getElementById('editPackageDiscord').value = pkg.discord_url || '';
     document.getElementById('editPackageLongDescription').value = pkg.long_description || '';
     document.getElementById('editPackageCategory').value = (pkg.category ? pkg.category.slug : '') || '';
     document.getElementById('editError').style.display = 'none';
     updateIconPreview();
     document.getElementById('editPackageModal').style.display = 'block';
   } catch (error) {
     console.error('Error opening edit modal:', error);
   }
 }

 function updateIconPreview() {
   const iconUrl = document.getElementById('editPackageIcon').value;
   const preview = document.getElementById('iconPreview');
   
   if (iconUrl.trim()) {
     preview.innerHTML = `
       <div style="padding: 10px; background: #1a1a1a; border: 1px solid #333; text-align: center;">
         <img src="${escapeHtml(iconUrl)}" alt="Icon preview" style="max-width: 100px; max-height: 100px; border: 1px solid #333;">
       </div>
     `;
   } else {
     preview.innerHTML = '';
   }
 }

 function closeEditModal() {
   document.getElementById('editPackageModal').style.display = 'none';
   packageToEdit = null;
 }

  document.addEventListener('DOMContentLoaded', () => {
    const iconUrlInput = document.getElementById('editPackageIcon');
    if (iconUrlInput) {
      iconUrlInput.addEventListener('input', updateIconPreview);
    }
  });

  // Event delegation for edit and delete buttons
  document.addEventListener('click', function (event) {
    // Handle edit button clicks
    if (event.target.matches('[data-action="edit-package"]')) {
      const packageId = event.target.getAttribute('data-package-id');
      const packageName = event.target.getAttribute('data-package-name');
      openEditModal(parseInt(packageId), packageName);
    }
    
    // Handle delete button clicks
    if (event.target.matches('[data-action="delete-package"]')) {
      const packageId = event.target.getAttribute('data-package-id');
      const packageName = event.target.getAttribute('data-package-name');
      openDeleteModal(parseInt(packageId), packageName);
    }
  });

 async function openDeleteModal(packageId, packageName) {
   try {
     const response = await fetch(`${API_URL}/packages/${encodeURIComponent(packageName)}/full`);
     if (!response.ok) {
       console.error('Failed to fetch package:', response.status);
       return;
     }
     
     const result = await response.json();
     if (!result.success || !result.data) {
       console.error('Invalid package data:', result);
       return;
     }
     
     const pkg = result.data;
     packageToDelete = { id: packageId, name: pkg.name };
     const infoDiv = document.getElementById('deletePackageInfo');
     infoDiv.innerHTML = `
       <p><strong>Package:</strong> ${escapeHtml(pkg.name)}</p>
       <p><strong>ID:</strong> ${packageId}</p>
     `;
     document.getElementById('deletePackageModal').style.display = 'block';
   } catch (error) {
     console.error('Error opening delete modal:', error);
   }
 }

function closeDeleteModal() {
  document.getElementById('deletePackageModal').style.display = 'none';
  packageToDelete = null;
}

window.onclick = function(event) {
  const editModal = document.getElementById('editPackageModal');
  const deleteModal = document.getElementById('deletePackageModal');
  
  if (event.target === editModal) {
    editModal.style.display = 'none';
  }
  if (event.target === deleteModal) {
    deleteModal.style.display = 'none';
  }
}

 async function savePackageChanges(event) {
   event.preventDefault();

   if (!packageToEdit) {
     return;
   }

   const description = document.getElementById('editPackageDescription').value;
   const longDescription = document.getElementById('editPackageLongDescription').value;
   const version = document.getElementById('editPackageVersion').value;
   const iconUrl = document.getElementById('editPackageIcon').value.trim();
   const kofiUrl = document.getElementById('editPackageKofi').value.trim();
   const youtubeUrl = document.getElementById('editPackageYoutube').value.trim();
   const discordUrl = document.getElementById('editPackageDiscord').value.trim();
   const category = document.getElementById('editPackageCategory').value;
   const errorDiv = document.getElementById('editError');

   errorDiv.style.display = 'none';

   // Validate Ko-fi URL if provided
   if (kofiUrl) {
     const kofiUrlRegex = /^https?:\/\/(www\.)?ko-fi\.com\/[a-zA-Z0-9_]+\/?$/;
     if (!kofiUrlRegex.test(kofiUrl)) {
       errorDiv.textContent = 'Invalid Ko-fi URL. Use format: https://ko-fi.com/username';
       errorDiv.style.display = 'block';
       return;
     }
   }

   // Validate YouTube URL if provided
   if (youtubeUrl) {
     const youtubeUrlRegex = /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[a-zA-Z0-9_-]+/;
     if (!youtubeUrlRegex.test(youtubeUrl)) {
       errorDiv.textContent = 'Invalid YouTube URL. Use a valid YouTube video URL.';
       errorDiv.style.display = 'block';
       return;
     }
   }

   // Validate Discord URL if provided
   if (discordUrl) {
     const discordUrlRegex = /^https?:\/\/(www\.)?(discord\.(gg|com)\/|discordapp\.com\/invite\/)[a-zA-Z0-9_-]+/;
     if (!discordUrlRegex.test(discordUrl)) {
       errorDiv.textContent = 'Invalid Discord URL. Use a valid Discord invite link.';
       errorDiv.style.display = 'block';
       return;
     }
   }

   try {
     const response = await fetch(`${API_URL}/packages/${packageToEdit.id}`, {
       method: 'PUT',
       headers: {
         'Content-Type': 'application/json',
         'Authorization': `Bearer ${authToken}`,
       },
       body: JSON.stringify({ 
         name: packageToEdit.name,
         description,
         version,
         iconUrl: iconUrl || null,
         kofiUrl: kofiUrl || null,
         youtubeUrl: youtubeUrl || null,
         discordUrl: discordUrl || null,
         longDescription: longDescription || null,
         category: category || null
       }),
     });

     const data = await response.json();

     if (!response.ok || !data.success) {
       throw new Error(data.error || 'Failed to update package');
     }

     const successDiv = document.getElementById('packageSuccessMsg');
     successDiv.textContent = 'Package updated successfully!';
     successDiv.style.display = 'block';

     setTimeout(() => {
       successDiv.style.display = 'none';
     }, 3000);

     closeEditModal();
     loadPackages();
   } catch (error) {
     errorDiv.textContent = error.message;
     errorDiv.style.display = 'block';
   }
 }

 async function confirmDeletePackage() {
   if (!packageToDelete) {
     return;
   }

   const packageId = packageToDelete.id;

   try {
     const response = await fetch(`${API_URL}/packages/${packageId}`, {
       method: 'DELETE',
       headers: {
         'Authorization': `Bearer ${authToken}`,
       },
     });

     const data = await response.json();

     if (!response.ok || !data.success) {
       throw new Error(data.error || 'Failed to delete package');
     }

     const successDiv = document.getElementById('packageSuccessMsg');
     successDiv.textContent = 'Package deleted successfully!';
     successDiv.style.display = 'block';

     setTimeout(() => {
       successDiv.style.display = 'none';
     }, 3000);

     closeDeleteModal();
     loadPackages();
   } catch (error) {
     alert('Error: ' + error.message);
   }
 }

 // ==================== USER MANAGEMENT ====================

 let userToEdit = null;
 let userToDelete = null;

 async function openEditUserModal(userId, username, email) {
   userToEdit = { id: userId, username };
   document.getElementById('editUserUsername').value = username;
   document.getElementById('editUserEmail').value = email;
   document.getElementById('editUserPassword').value = '';
   document.getElementById('editUserError').style.display = 'none';
   document.getElementById('editUserModal').style.display = 'block';
 }

 function closeEditUserModal() {
   document.getElementById('editUserModal').style.display = 'none';
   userToEdit = null;
 }

 async function saveUserChanges(event) {
   event.preventDefault();

   if (!userToEdit) {
     return;
   }

   const username = document.getElementById('editUserUsername').value;
   const email = document.getElementById('editUserEmail').value;
   const password = document.getElementById('editUserPassword').value;
   const errorDiv = document.getElementById('editUserError');

   errorDiv.style.display = 'none';

   // Basic validation
   if (!username || !email) {
     errorDiv.textContent = 'Username and email are required';
     errorDiv.style.display = 'block';
     return;
   }

   const requestBody = {
     username,
     email,
     password: password || null,
   };

   try {
     const response = await fetch(`${API_URL}/admin/users/${userToEdit.id}`, {
       method: 'PUT',
       headers: {
         'Content-Type': 'application/json',
         'Authorization': `Bearer ${authToken}`,
       },
       body: JSON.stringify(requestBody),
     });

     const data = await response.json();

     if (!response.ok || !data.success) {
       throw new Error(data.error || 'Failed to update user');
     }

     const successDiv = document.getElementById('successMsg');
     successDiv.textContent = 'User updated successfully!';
     successDiv.style.display = 'block';

     setTimeout(() => {
       successDiv.style.display = 'none';
     }, 3000);

     closeEditUserModal();
     loadUsers();
   } catch (error) {
     errorDiv.textContent = error.message;
     errorDiv.style.display = 'block';
   }
 }

 async function openDeleteUserModal(userId, username) {
   userToDelete = { id: userId, username };
   const infoDiv = document.getElementById('deleteUserInfo');
   infoDiv.innerHTML = `
     <p><strong>Username:</strong> ${escapeHtml(username)}</p>
     <p><strong>ID:</strong> ${userId}</p>
   `;
   document.getElementById('deleteUserModal').style.display = 'block';
 }

 function closeDeleteUserModal() {
   document.getElementById('deleteUserModal').style.display = 'none';
   userToDelete = null;
 }

 async function confirmDeleteUser() {
   if (!userToDelete) {
     return;
   }

   const userId = userToDelete.id;

   try {
     const response = await fetch(`${API_URL}/admin/users/${userId}`, {
       method: 'DELETE',
       headers: {
         'Authorization': `Bearer ${authToken}`,
       },
     });

     const data = await response.json();

     if (!response.ok || !data.success) {
       throw new Error(data.error || 'Failed to delete user');
     }

     const successDiv = document.getElementById('successMsg');
     successDiv.textContent = 'User deleted successfully!';
     successDiv.style.display = 'block';

     setTimeout(() => {
       successDiv.style.display = 'none';
     }, 3000);

     closeDeleteUserModal();
     loadUsers();
   } catch (error) {
     alert('Error: ' + error.message);
   }
 }

 // Event delegation for edit and delete user buttons
 document.addEventListener('click', function (event) {
   // Handle edit user button clicks
   if (event.target.matches('[data-action="edit-user"]')) {
     const userId = event.target.getAttribute('data-user-id');
     const username = event.target.getAttribute('data-user-username');
     const email = event.target.getAttribute('data-user-email');
     openEditUserModal(parseInt(userId), username, email);
   }

   // Handle delete user button clicks
   if (event.target.matches('[data-action="delete-user"]')) {
     const userId = event.target.getAttribute('data-user-id');
     const username = event.target.getAttribute('data-user-username');
     openDeleteUserModal(parseInt(userId), username);
   }
 });

 window.onclick = function(event) {
   const editUserModal = document.getElementById('editUserModal');
   const deleteUserModal = document.getElementById('deleteUserModal');
   const editPackageModal = document.getElementById('editPackageModal');
   const deletePackageModal = document.getElementById('deletePackageModal');
   
   if (event.target === editUserModal) {
     editUserModal.style.display = 'none';
   }
   if (event.target === deleteUserModal) {
     deleteUserModal.style.display = 'none';
   }
   if (event.target === editPackageModal) {
     editPackageModal.style.display = 'none';
   }
   if (event.target === deletePackageModal) {
     deletePackageModal.style.display = 'none';
   }
 }