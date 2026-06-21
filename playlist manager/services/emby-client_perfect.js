// ═════════════════════════════════════════════
// Emby Client Service
// ═════════════════════════════════════════════

const axios = require('axios');

class EmbyClient {
  constructor(serverUrl, token, userId, logger) {
    this.serverUrl = serverUrl || '';
    this.token = token || '';
    this.userId = userId || '';
    this.logger = logger;
    
    // Create axios client with Emby headers
    this.client = axios.create({
      baseURL: this.serverUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'X-Emby-Token': this.token,
        'X-Emby-Client': 'SmartPlaylist',
        'X-Emby-Client-Version': '1.0.0',
        'X-Emby-Device-Name': 'SmartPlaylistBackend',
        'X-Emby-Device-Id': 'smart-playlist-backend'
      }
    });
  }

  // ═════════════════════════════════════════════
  // HEALTH & CONNECTION
  // ═════════════════════════════════════════════

  async getHealth() {
    try {
      const response = await this.client.get('/System/Info');
      this.logger.info('✓ Emby health check passed');
      return response.status === 200;
    } catch (error) {
      this.logger.warn('✗ Emby health check failed', error.message);
      return false;
    }
  }

  // ═════════════════════════════════════════════
  // LIBRARY OPERATIONS
  // ═════════════════════════════════════════════

  async getLibraryItems(filters = {}) {
    try {
      this.logger.info('Fetching library items from user endpoint...');
      
      const params = {
        Fields: 'GenreItems,ProviderIds,Genres,People,CommunityRating,CriticRating,OfficialRating,ProductionYear,Studios,UserData',
        IncludeItemTypes: 'Movie',
        IsFolder: false,  // IMPORTANT: exclude folders/libraries
        Recursive: true,   // Search recursively in all folders
        Limit: 5000,
        EnableUserData: true,  // Include UserData for Played/Favorite info
        ...filters
      };

      // CRITICAL: Use /Users/{userId}/Items endpoint for proper UserData
      const response = await this.client.get(`/Users/${this.userId}/Items`, { params });
      const items = response.data.Items || [];
      const itemCount = items.length;
      
      this.logger.info(`✓ Fetched ${itemCount} library items with UserData`);
      
      // Log first few items with their UserData
      if (items.length > 0) {
        this.logger.info(`First item details:`);
        const firstItem = items[0];
        this.logger.info(`  Name: ${firstItem.Name}`);
        this.logger.info(`  UserData: ${JSON.stringify(firstItem.UserData)}`);
        this.logger.info(`  Played: ${firstItem.UserData?.Played}`);
        this.logger.info(`  IsFavorite: ${firstItem.UserData?.IsFavorite}`);
        this.logger.info(`  GenreItems: ${JSON.stringify(firstItem.GenreItems)}`);
      }
      
      return items;
    } catch (error) {
      this.logger.error('✗ Get library items failed', error.message);
      throw error;
    }
  }

  async getItemDetails(itemId) {
    try {
      this.logger.info(`Fetching item details: ${itemId}`);
      
      // Use user-specific endpoint (more reliable for BoxSets/Collections)
      const response = await this.client.get(`/Users/${this.userId}/Items/${itemId}`);
      
      this.logger.info(`✓ Got item: ${response.data.Name}`);
      return response.data;
    } catch (error) {
      this.logger.error(`✗ Get item ${itemId} failed`, error.message);
      throw error;
    }
  }

  // ═════════════════════════════════════════════
  // COLLECTION OPERATIONS
  // ═════════════════════════════════════════════

  async getCollections() {
    try {
      this.logger.info('Fetching collections from user endpoint...');
      
      const params = {
        IncludeItemTypes: 'BoxSet',
        EnableUserData: true
      };

      // Use user-specific endpoint for consistency
      const response = await this.client.get(`/Users/${this.userId}/Items`, { params });
      const collCount = response.data.Items?.length || 0;
      this.logger.info(`✓ Found ${collCount} collections`);
      return response.data.Items || [];
    } catch (error) {
      this.logger.error('✗ Get collections failed', error.message);
      throw error;
    }
  }

  async createCollection(name, itemIds, description = '') {
    try {
      if (!itemIds || itemIds.length === 0) {
        throw new Error('No items provided for collection');
      }

      this.logger.info(`═══════════════════════════════════════════`);
      this.logger.info(`Creating collection: "${name}"`);
      this.logger.info(`Items to add: ${itemIds.length}`);
      this.logger.info(`First 3 IDs: ${itemIds.slice(0, 3).join(', ')}`);
      this.logger.info(`═══════════════════════════════════════════`);

      // Build query string per official Emby API docs
      const qs = 'Name=' + encodeURIComponent(name) + 
                 '&Ids=' + itemIds.join(',');

      this.logger.info(`Query string: ${qs}`);

      // Use fetch per official Emby API docs - NO BODY
      const fullUrl = this.serverUrl + '/Collections?' + qs;
      this.logger.info(`Full URL: ${fullUrl}`);

      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Emby-Token': this.token,
          'X-Emby-Client': 'SmartPlaylist',
          'X-Emby-Client-Version': '1.0.0',
          'X-Emby-Device-Name': 'SmartPlaylistBackend',
          'X-Emby-Device-Id': 'smart-playlist-backend'
        }
        // NO body - per official API
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorData}`);
      }

      const data = await response.json();
      const collectionId = data?.Id;
      
      if (!collectionId) {
        throw new Error('Failed to get collection ID from response. Response: ' + JSON.stringify(data));
      }

      this.logger.info(`✓ Collection created successfully`);
      this.logger.info(`  ID: ${collectionId}`);
      this.logger.info(`  Name: ${name}`);
      this.logger.info(`  Items: ${itemIds.length}`);

      // Send description if provided
      if (description && description.trim()) {
        this.logger.info(`  Setting description: ${description.substring(0, 50)}...`);
        try {
          await this.updateCollectionDescription(collectionId, description);
          this.logger.info(`  ✓ Description added`);
        } catch (descError) {
          this.logger.warn(`  ⚠ Could not add description: ${descError.message}`);
          // Don't throw - collection was created successfully
        }
      }

      return {
        id: collectionId,
        name: name,
        itemCount: itemIds.length
      };
    } catch (error) {
      this.logger.error('✗ Create collection failed', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        name: name,
        itemCount: itemIds?.length
      });
      throw error;
    }
  }

  async updateCollection(collectionId, data) {
    try {
      const { items, ...metadata } = data;

      this.logger.info(`Updating collection: ${collectionId}`);

      // Update items if provided
      if (items && items.length > 0) {
        this.logger.info(`  Removing old items...`);
        
        const oldItems = await this.getCollectionItems(collectionId);
        if (oldItems.length > 0) {
          await this.client.post(`/Collections/${collectionId}/Items/Remove`, {
            Ids: oldItems
          });
        }

        this.logger.info(`  Adding ${items.length} new items...`);
        
        await this.client.post(`/Collections/${collectionId}/Items/Add`, {
          Ids: items
        });
      }

      // Update metadata (name, etc)
      if (Object.keys(metadata).length > 0) {
        this.logger.info(`  Updating metadata...`);
        await this.updateItemMetadata(collectionId, metadata);
      }

      this.logger.info(`✓ Collection updated: ${collectionId}`);
      return { id: collectionId, updated: true };
    } catch (error) {
      this.logger.error('✗ Update collection failed', error.message);
      throw error;
    }
  }

  async deleteCollection(collectionId) {
    try {
      this.logger.info(`Deleting collection: ${collectionId}`);
      
      await this.client.delete(`/Items/${collectionId}`);

      this.logger.info(`✓ Collection deleted: ${collectionId}`);
      return { deleted: true };
    } catch (error) {
      this.logger.error('✗ Delete collection failed', error.message);
      throw error;
    }
  }

  async getCollectionItems(collectionId) {
    try {
      const response = await this.client.get(`/Collections/${collectionId}/Items`);
      return response.data.Items?.map(item => item.Id) || [];
    } catch (error) {
      this.logger.warn(`Get collection items failed: ${collectionId}`, error.message);
      return [];
    }
  }

  // ═════════════════════════════════════════════
  // METADATA OPERATIONS
  // ═════════════════════════════════════════════

  async updateItemMetadata(itemId, data) {
    try {
      this.logger.info(`Updating item metadata: ${itemId}`);
      
      const updateData = {
        Id: itemId,
        ...data
      };

      await this.client.post(`/Items/${itemId}`, updateData);

      this.logger.info(`✓ Item metadata updated: ${itemId}`);
      return { id: itemId, updated: true };
    } catch (error) {
      this.logger.error('✗ Update item metadata failed', error.message);
      throw error;
    }
  }

  async updateCollectionDescription(collectionId, description) {
    try {
      this.logger.info(`Updating collection description: ${collectionId}`);
      
      // Wait for collection to be indexed AND genres auto-populated from items
      this.logger.info(`  Waiting 3000ms for Emby to index and auto-populate genres...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Step 1: GET the full item using query params
      this.logger.info(`  Step 1: Fetching item...`);
      const getUrl = `${this.serverUrl}/Items?Ids=${collectionId}&api_key=${this.token}`;
      
      const getResponse = await fetch(getUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!getResponse.ok) {
        throw new Error(`GET failed: HTTP ${getResponse.status}`);
      }

      const getResult = await getResponse.json();
      if (!getResult.Items || getResult.Items.length === 0) {
        throw new Error('Collection not found');
      }

      const current_item = getResult.Items[0];
      this.logger.info(`  Step 2: Building update JSON...`);

      // Step 2: Build minimal JSON object - only update Overview, let Emby manage Genres
      const jsonToSend = {
        Name: current_item.Name,
        Id: current_item.Id,
        Type: current_item.Type,
        IsFolder: current_item.IsFolder,
        SortName: current_item.SortName || current_item.Name,
        Overview: description,
        OfficialRating: current_item.OfficialRating || '',
        DisplayOrder: current_item.DisplayOrder || 'PremiereDate',
        ProviderIds: current_item.ProviderIds || {},
        ImageTags: current_item.ImageTags || {},
        UserData: current_item.UserData || {
          PlaybackPositionTicks: 0,
          PlayCount: 0,
          IsFavorite: false,
          Played: false
        }
      };

      this.logger.info(`  Step 3: Posting update...`);
      const postUrl = `${this.serverUrl}/Items/${collectionId}?api_key=${this.token}`;
      
      const postResponse = await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jsonToSend)
      });

      if (!postResponse.ok) {
        const errorText = await postResponse.text();
        throw new Error(`POST failed: HTTP ${postResponse.status}: ${errorText}`);
      }

      this.logger.info(`✓ Description updated: ${collectionId}`);
      return { id: collectionId, updated: true };
    } catch (error) {
      this.logger.error('✗ Update collection description failed', error.message);
      throw error;
    }
  }

  // ═════════════════════════════════════════════
  // UTILITY METHODS
  // ═════════════════════════════════════════════

  async filterItemsByRule(items, rule) {
    try {
      // Placeholder for rule evaluation
      // Backend will handle rule evaluation logic
      return items;
    } catch (error) {
      this.logger.error('✗ Filter items failed', error.message);
      return items;
    }
  }
}

module.exports = EmbyClient;
