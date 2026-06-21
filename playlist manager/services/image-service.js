// ═════════════════════════════════════════════
// Image Service - Artwork Fetching & Caching
// Supports: Emby, fanart.tv (TMDB-based)
// ═════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Image directory
const IMAGE_DIR = path.join(__dirname, '../data/images');

// Ensure image directory exists
if (!fs.existsSync(IMAGE_DIR)) {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

// ═════════════════════════════════════════════
// INTERNAL HELPERS
// ═════════════════════════════════════════════

function ensureCollectionDir(collectionId) {
  const collDir = path.join(IMAGE_DIR, collectionId.toString());
  if (!fs.existsSync(collDir)) {
    fs.mkdirSync(collDir, { recursive: true });
  }
  return collDir;
}

function getImagePath(collectionId, source) {
  return path.join(IMAGE_DIR, collectionId.toString(), `${source}.jpg`);
}

function getMetadataPath(collectionId) {
  return path.join(IMAGE_DIR, collectionId.toString(), 'metadata.json');
}

function readMetadata(collectionId) {
  try {
    const metaPath = getMetadataPath(collectionId);
    if (fs.existsSync(metaPath)) {
      return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading metadata:', e.message);
  }
  return { sources: {}, preferred: 'fanart', lastUpdated: null };
}

function writeMetadata(collectionId, metadata) {
  try {
    const metaPath = getMetadataPath(collectionId);
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
  } catch (e) {
    console.error('Error writing metadata:', e.message);
  }
}

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const buffer = [];

    protocol.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      res.on('data', chunk => buffer.push(chunk));
      res.on('end', () => resolve(Buffer.concat(buffer)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ═════════════════════════════════════════════
// MAIN FUNCTIONS
// ═════════════════════════════════════════════

/**
 * Get TMDB ID from Emby collection
 * First tries Emby's ProviderIds.Tmdb
 */
async function getTmdbIdFromEmby(embyApi, collectionId) {
  try {
    console.log(`  📦 Fetching Emby metadata for collection ${collectionId}...`);
    
    const resp = await embyApi.getItemDetails(collectionId);

    if (resp && resp.ProviderIds && resp.ProviderIds.Tmdb) {
      console.log(`  ✓ Found TMDB ID in Emby: ${resp.ProviderIds.Tmdb}`);
      return {
        tmdbId: resp.ProviderIds.Tmdb,
        source: 'emby',
        genres: resp.Genres || []
      };
    }

    console.log(`  ⚠️ No TMDB ID in Emby ProviderIds`);
    return { tmdbId: null, source: 'emby', genres: resp?.Genres || [] };
  } catch (e) {
    console.error(`  ❌ Error querying Emby:`, e.message);
    return { tmdbId: null, source: 'emby', genres: [] };
  }
}

/**
 * Search TMDB API for movie/collection by title
 * @param {string} title - Collection title to search
 * @param {string} tmdbApiKey - TMDB API key
 * @param {array} genres - Optional genres for filtering
 */
async function searchTmdbByTitle(title, tmdbApiKey) {
  if (!title || !tmdbApiKey) {
    console.log(`  ⚠️ Missing title or API key for TMDB search`);
    return null;
  }

  try {
    console.log(`  🔍 Searching TMDB for: "${title}"`);
    
    const url = `https://api.themoviedb.org/3/search/movie?api_key=${tmdbApiKey}&query=${encodeURIComponent(title)}&page=1`;
    
    const response = await new Promise((resolve, reject) => {
      https.get(url, { timeout: 10000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        });
        res.on('error', reject);
      }).on('error', reject);
    });

    if (!response.results || response.results.length === 0) {
      console.log(`  ❌ No TMDB results for "${title}"`);
      return null;
    }

    // Pick first result (most relevant)
    const best = response.results[0];
    console.log(`  ✓ Found TMDB match: "${best.title}" (ID: ${best.id})`);
    
    return best.id;
  } catch (e) {
    console.error(`  ❌ TMDB search error:`, e.message);
    return null;
  }
}

/**
 * Fetch artwork from fanart.tv using TMDB ID
 * @param {number} tmdbId - TMDB Movie ID
 * @param {string} projectKey - fanart.tv project API key (app's key)
 * @param {string} clientKey - fanart.tv user's personal API key (optional)
 */
async function fetchFromFanartTV(tmdbId, projectKey, clientKey) {
  if (!tmdbId || !projectKey) {
    console.log(`  ⚠️ Missing TMDB ID or fanart.tv project key`);
    return null;
  }

  try {
    console.log(`  🎨 Fetching from fanart.tv (TMDB ID: ${tmdbId})...`);
    
    const FanartTVClient = require('@fanart-tv/api');
    const client = new FanartTVClient({
      apiKey: projectKey,
      // Include user's personal key for better rate limits if provided
      clientKey: clientKey || undefined,
      version: 'v3.2'
    });

    const artwork = await client.getMovie(tmdbId);

    if (!artwork) {
      console.log(`  ⚠️ No artwork found on fanart.tv`);
      return null;
    }

    console.log(`  ✓ Got ${artwork.image_count || 0} images from fanart.tv`);

    // Get best poster (highest likes)
    const posters = artwork.images?.movieposter || [];
    if (posters.length > 0) {
      // Sort by likes (descending)
      posters.sort((a, b) => {
        const likesA = parseInt(a.likes) || 0;
        const likesB = parseInt(b.likes) || 0;
        return likesB - likesA;
      });

      const best = posters[0];
      console.log(`  ✓ Best poster: ${best.url}`);

      return {
        success: true,
        imageUrl: best.url,
        imageCount: artwork.image_count,
        source: 'fanart'
      };
    }

    console.log(`  ⚠️ No posters available on fanart.tv`);
    return null;
  } catch (e) {
    console.error(`  ❌ fanart.tv error:`, e.message);
    return null;
  }
}

/**
 * Download image from URL and save to disk
 * @param {string} url - Image URL
 * @param {string} filePath - Where to save
 */
async function saveImage(url, filePath) {
  try {
    console.log(`  ⬇️ Downloading image...`);
    
    const imageBuffer = await downloadImage(url);
    fs.writeFileSync(filePath, imageBuffer);
    
    const sizeKb = (imageBuffer.length / 1024).toFixed(2);
    console.log(`  ✓ Saved ${sizeKb} KB to disk`);
    
    return true;
  } catch (e) {
    console.error(`  ❌ Download/save error:`, e.message);
    return false;
  }
}

/**
 * Main orchestration function
 * Fetches artwork from all available sources for a collection
 */
async function fetchAllArtwork(embyApi, collectionId, tmdbApiKey, fanartProjectKey, fanartClientKey) {
  console.log(`\n📸 FETCHING ARTWORK FOR COLLECTION ${collectionId}`);
  console.log(`${'═'.repeat(50)}`);

  const result = {
    success: false,
    sources: {
      fanart: { found: false, url: null },
      emby: { found: false, url: null }
    },
    preferred: 'fanart',
    errors: []
  };

  const collDir = ensureCollectionDir(collectionId);

  // ─────────────────────────────────────
  // 1. TRY FANART.TV (via TMDB)
  // ─────────────────────────────────────

  let tmdbId = null;

  // First: Check Emby's existing TMDB ID
  const embyCheck = await getTmdbIdFromEmby(embyApi, collectionId);
  if (embyCheck.tmdbId) {
    tmdbId = embyCheck.tmdbId;
  }

  // Second: Search TMDB if not found
  if (!tmdbId && tmdbApiKey) {
    // Get collection name from Emby
    try {
      const collInfo = await embyApi.getItemDetails(collectionId);
      if (collInfo && collInfo.Name) {
        tmdbId = await searchTmdbByTitle(collInfo.Name, tmdbApiKey);
      }
    } catch (e) {
      console.error('  ❌ Could not get collection name:', e.message);
    }
  }

  // Fetch from fanart.tv if we have TMDB ID and project key
  if (tmdbId && fanartProjectKey) {
    const fanartResult = await fetchFromFanartTV(tmdbId, fanartProjectKey, fanartClientKey);
    if (fanartResult) {
      const fanartPath = getImagePath(collectionId, 'fanart');
      if (await saveImage(fanartResult.imageUrl, fanartPath)) {
        result.sources.fanart.found = true;
        result.sources.fanart.url = `/api/images/${collectionId}/fanart.jpg`;
        result.sources.fanart.tmdbId = tmdbId;
        result.success = true;
        console.log(`  ✅ fanart.tv artwork saved`);
      }
    }
  } else if (!tmdbId) {
    result.errors.push('Could not find TMDB ID');
  } else if (!fanartProjectKey) {
    result.errors.push('fanart.tv project key not configured');
  }

  // ─────────────────────────────────────
  // 2. TRY EMBY (if available)
  // ─────────────────────────────────────

  try {
    console.log(`\n  🏠 Fetching from Emby Images API...`);
    
    const itemResp = await embyApi.getItemDetails(collectionId);

    if (itemResp && itemResp.ImageTags && itemResp.ImageTags.Primary) {
      const imageTag = itemResp.ImageTags.Primary;
      const embyImageUrl = `${embyApi.serverUrl}/Items/${collectionId}/Images/Primary?tag=${encodeURIComponent(imageTag)}`;
      
      const embyPath = getImagePath(collectionId, 'emby');
      if (await saveImage(embyImageUrl, embyPath)) {
        result.sources.emby.found = true;
        result.sources.emby.url = `/api/images/${collectionId}/emby.jpg`;
        result.sources.emby.imageTag = imageTag;
        if (!result.success) result.success = true;  // Mark success if fanart failed but emby worked
        console.log(`  ✅ Emby artwork saved`);
      }
    }
  } catch (e) {
    console.error(`  ⚠️ Emby artwork unavailable:`, e.message);
  }

  // ─────────────────────────────────────
  // 3. GENRE-BASED FALLBACK: Find artwork matching collection genres
  // ─────────────────────────────────────

  if (!result.success && fanartProjectKey && tmdbApiKey) {
    try {
      console.log(`\n  🎭 Genre-Based Fallback: Analyzing collection genres...`);
      
      // Get item IDs in the collection (or try BoxSet endpoint if Collection fails)
      let itemIds = await embyApi.getCollectionItems(collectionId);
      console.log(`  📊 getCollectionItems returned:`, itemIds);
      console.log(`  📊 Type:`, typeof itemIds, `Length:`, itemIds?.length || 0);
      
      // If collection is empty, try as BoxSet with different endpoint
      if (!itemIds || itemIds.length === 0) {
        console.log(`  ℹ️ Collection endpoint returned empty, querying items with ParentId...`);
        try {
          // Query items where ParentId matches the collection
          const boxSetItems = await embyApi.client.get(`/Users/${embyApi.userId}/Items`, { 
            params: { 
              ParentId: collectionId,
              IncludeItemTypes: 'Movie',
              Limit: 100,
              Recursive: false
            } 
          });
          if (boxSetItems.data && boxSetItems.data.Items) {
            itemIds = boxSetItems.data.Items.map(item => item.Id);
            console.log(`  ✓ Got ${itemIds.length} items using ParentId query`);
          }
        } catch (e) {
          console.log(`  ⚠️ ParentId query failed: ${e.message}`);
        }
      }
      
      if (!itemIds || itemIds.length === 0) {
        console.log(`  ⚠️ No items returned. Collection might be empty`);
        result.errors.push('Collection returned no items');
      } else {
        // Collect genres from collection items
        const genreMap = {};
        
        for (const itemId of itemIds.slice(0, 50)) {  // Limit to 50 items for performance
          try {
            const itemDetails = await embyApi.getItemDetails(itemId);
            if (itemDetails && itemDetails.Genres && Array.isArray(itemDetails.Genres)) {
              itemDetails.Genres.forEach(genre => {
                genreMap[genre] = (genreMap[genre] || 0) + 1;
              });
            }
          } catch (e) {
            // Skip items that fail
            console.log(`    ⚠️ Could not get details for item ${itemId}`);
          }
        }

        const genres = Object.entries(genreMap)
          .sort((a, b) => b[1] - a[1])  // Sort by frequency
          .map(entry => entry[0])
          .slice(0, 3);  // Top 3 genres

        console.log(`  ✓ Collection genres: ${genres.join(', ')}`);

        if (genres.length > 0) {
          // Search TMDB for popular movies with these genres
          const genreQuery = genres.join(' ');
          console.log(`  🔍 Searching TMDB for popular "${genreQuery}" movies...`);
          
          const tmdbUrl = `https://api.themoviedb.org/3/search/movie?api_key=${tmdbApiKey}&query=${encodeURIComponent(genreQuery)}&page=1&sort_by=popularity.desc`;
          
          const tmdbResponse = await new Promise((resolve, reject) => {
            const https = require('https');
            https.get(tmdbUrl, { timeout: 10000 }, (res) => {
              let data = '';
              res.on('data', chunk => data += chunk);
              res.on('end', () => {
                try {
                  resolve(JSON.parse(data));
                } catch (e) {
                  reject(new Error('Invalid JSON'));
                }
              });
              res.on('error', reject);
            }).on('error', reject);
          });

          if (tmdbResponse.results && tmdbResponse.results.length > 0) {
            // Try each result until we find artwork
            for (const movie of tmdbResponse.results.slice(0, 5)) {
              if (!movie.id) continue;
              
              console.log(`  🎬 Trying: "${movie.title}" (TMDB ID: ${movie.id})`);
              const fanartResult = await fetchFromFanartTV(movie.id, fanartProjectKey, fanartPersonalKey);
              
              if (fanartResult) {
                const fanartPath = getImagePath(collectionId, 'fanart');
                if (await saveImage(fanartResult.imageUrl, fanartPath)) {
                  result.sources.fanart.found = true;
                  result.sources.fanart.url = `/api/images/${collectionId}/fanart.jpg`;
                  result.sources.fanart.tmdbId = movie.id;
                  result.sources.fanart.sourceMovie = movie.title;
                  result.sources.fanart.matchedGenres = genres;
                  result.success = true;
                  console.log(`  ✅ Found artwork from "${movie.title}" (matched genres: ${genres.join(', ')})`);
                  break;
                }
              }
            }
          }
        } else {
          result.errors.push('No genres found in collection');
        }
      }
    } catch (e) {
      console.error(`  ❌ Genre-based fallback error:`, e.message);
      result.errors.push(`Genre fallback error: ${e.message}`);
    }
  }

  // ─────────────────────────────────────
  // 4. SAVE METADATA
  // ─────────────────────────────────────

  const metadata = {
    sources: result.sources,
    preferred: result.preferred,
    lastUpdated: new Date().toISOString(),
    errors: result.errors
  };
  writeMetadata(collectionId, metadata);

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Result: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
  console.log(`Sources available: fanart=${result.sources.fanart.found}, emby=${result.sources.emby.found}`);

  return result;
}

/**
 * Get what image sources are available for a collection
 */
function getAvailableSources(collectionId) {
  try {
    const metadata = readMetadata(collectionId);
    const available = {};

    for (const [source, info] of Object.entries(metadata.sources)) {
      available[source] = fs.existsSync(getImagePath(collectionId, source));
    }

    return {
      metadata: metadata,
      available: available,
      preferred: metadata.preferred
    };
  } catch (e) {
    console.error('Error getting available sources:', e.message);
    return { metadata: {}, available: {}, preferred: null };
  }
}

/**
 * Delete all cached images for a collection
 */
function deleteCollectionImages(collectionId) {
  try {
    const collDir = path.join(IMAGE_DIR, collectionId.toString());
    if (fs.existsSync(collDir)) {
      fs.rmSync(collDir, { recursive: true, force: true });
      console.log(`✓ Deleted images for collection ${collectionId}`);
      return true;
    }
    return false;
  } catch (e) {
    console.error('Error deleting collection images:', e.message);
    return false;
  }
}

/**
 * Serve image file
 */
function serveImage(collectionId, source) {
  try {
    const filePath = getImagePath(collectionId, source);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const stats = fs.statSync(filePath);
    const buffer = fs.readFileSync(filePath);

    return {
      buffer: buffer,
      mimeType: 'image/jpeg',
      size: stats.size,
      modified: stats.mtime
    };
  } catch (e) {
    console.error('Error serving image:', e.message);
    return null;
  }
}

// ═════════════════════════════════════════════
// EXPORTS
// ═════════════════════════════════════════════

module.exports = {
  fetchAllArtwork,
  getTmdbIdFromEmby,
  searchTmdbByTitle,
  fetchFromFanartTV,
  saveImage,
  getImagePath,
  getAvailableSources,
  deleteCollectionImages,
  serveImage
};
