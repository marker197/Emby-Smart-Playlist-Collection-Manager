/**
 * MDBlists Curl Service
 * Executes curl commands for MDBlists API calls
 */

const { execSync } = require('child_process');

/**
 * Execute a curl command safely
 * @param {string} curlCmd - The curl command to execute
 * @returns {Promise<Object>} - Parsed JSON response
 */
async function executeCurl(curlCmd) {
  try {
    if (!curlCmd) {
      throw new Error('Missing curl command');
    }

    console.log(`[MDBlists] Executing curl command: ${curlCmd.substring(0, 100)}...`);

    // Execute curl command
    const output = execSync(curlCmd, { 
      encoding: 'utf-8',
      timeout: 30000 // 30 second timeout
    });

    // Parse JSON response
    const jsonData = JSON.parse(output);
    
    console.log(`[MDBlists] ✓ Curl executed successfully`);
    return jsonData;

  } catch (error) {
    console.error(`[MDBlists] ✗ Curl execution failed: ${error.message}`);
    throw new Error(`MDBlists curl failed: ${error.message}`);
  }
}

module.exports = {
  executeCurl
};
