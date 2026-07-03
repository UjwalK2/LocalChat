const ApiService = {
  // Base API path
  BASE_URL: '/api',

  // Get auth token from localStorage
  getToken() {
    return localStorage.getItem('token');
  },

  // Save auth token and user to localStorage
  setSession(token, user) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  },

  // Clear session on logout
  clearSession() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },

  // Common fetch wrapper to handle errors and inject JWT
  async _request(endpoint, options = {}) {
    const url = `${this.BASE_URL}${endpoint}`;
    
    // Set headers
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    // Inject token if available
    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const config = {
      ...options,
      headers
    };

    try {
      const response = await fetch(url, config);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }

      return data;
    } catch (err) {
      console.error(`API Error on ${endpoint}:`, err.message);
      throw err;
    }
  },

  // User Registration
  async register(username, password, displayName) {
    return this._request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, displayName })
    });
  },

  // User Login
  async login(username, password) {
    return this._request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
  },

  // Get current user details using stored token
  async getCurrentUser() {
    return this._request('/auth/me', {
      method: 'GET'
    });
  }
};
