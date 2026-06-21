// ═════════════════════════════════════════════
// Rules Engine Service
// ═════════════════════════════════════════════

class RulesEngine {
  constructor(logger) {
    this.logger = logger;
  }

  // ═════════════════════════════════════════════
  // MAIN EVALUATION METHOD
  // ═════════════════════════════════════════════

  evaluateRule(rule, items) {
    try {
      if (!rule || !items || items.length === 0) {
        return [];
      }

      // Normalize rule: convert 'logic' to 'type' if needed
      const normalizedRule = {
        ...rule,
        type: rule.type || rule.logic
      };

      this.logger.info(`[DEBUG] Rule: ${rule.name}, Logic: ${normalizedRule.type}`);
      this.logger.info(`[DEBUG] Conditions: ${JSON.stringify(normalizedRule.conditions)}`);
      this.logger.info(`[DEBUG] Total items: ${items.length}`);
      
      if (items.length > 0) {
        this.logger.info(`[DEBUG] First item GenreItems: ${JSON.stringify(items[0].GenreItems)}`);
      }

      // Evaluate the rule logic tree
      const result = this.evaluateLogicTree(normalizedRule, items);

      this.logger.info(`Rule evaluation complete: ${result.length} items matched`);
      return result;
    } catch (error) {
      this.logger.error('Rule evaluation failed', error);
      return [];
    }
  }

  // ═════════════════════════════════════════════
  // LOGIC TREE EVALUATION
  // ═════════════════════════════════════════════

  evaluateLogicTree(node, items) {
    // If node is a simple condition
    if (!node.type || (node.type !== 'AND' && node.type !== 'OR')) {
      return this.evaluateCondition(node, items);
    }

    // If node is a logic operator
    if (node.type === 'AND') {
      return this.evaluateAND(node, items);
    } else if (node.type === 'OR') {
      return this.evaluateOR(node, items);
    }

    return items;
  }

  evaluateAND(node, items) {
    // All sub-conditions must be true
    let result = items;

    for (const condition of node.conditions) {
      result = this.evaluateLogicTree(condition, result);
      if (result.length === 0) break; // Optimization: early exit
    }

    return result;
  }

  evaluateOR(node, items) {
    // Any sub-condition can be true
    const matchedIds = new Set();

    for (const condition of node.conditions) {
      const matches = this.evaluateLogicTree(condition, items);
      matches.forEach(item => matchedIds.add(item.Id));
    }

    // Return unique items that matched any condition
    return items.filter(item => matchedIds.has(item.Id));
  }

  // ═════════════════════════════════════════════
  // CONDITION EVALUATION
  // ═════════════════════════════════════════════

  evaluateCondition(condition, items) {
    const { field, operator, value } = condition;

    if (!field || !operator) {
      return items;
    }

    return items.filter(item => this.matchCondition(item, field, operator, value));
  }

  matchCondition(item, field, operator, value) {
    try {
      const itemValue = this.getFieldValue(item, field);

      switch (operator) {
        case 'contains':
          return this.matchContains(itemValue, value);
        case 'equals':
          return this.matchEquals(itemValue, value);
        case '=':
          return this.matchEquals(itemValue, value);
        case '>':
          return this.matchGreater(itemValue, value);
        case '<':
          return this.matchLess(itemValue, value);
        case '>=':
          return this.matchGreaterOrEqual(itemValue, value);
        case '<=':
          return this.matchLessOrEqual(itemValue, value);
        case 'between':
          return this.matchBetween(itemValue, value);
        case 'not':
          return this.matchNot(itemValue, value);
        case 'is':
          // For boolean fields: is true
          return itemValue === 'true' || itemValue === true;
        case 'isNot':
          // For boolean fields: is not true (i.e., is false)
          return itemValue === 'false' || itemValue === false;
        default:
          return true;
      }
    } catch (e) {
      return false;
    }
  }

  getFieldValue(item, field) {
    switch (field) {
      case 'genre':
        // Try GenreItems first (array of {Name, Id}), fall back to Genres (array of strings)
        if (item.GenreItems && Array.isArray(item.GenreItems)) {
          return item.GenreItems.map(g => g.Name || g);
        }
        return item.Genres || [];
      case 'year':
        return item.ProductionYear || 0;
      case 'rating':
        return item.CommunityRating || 0;
      case 'criticRating':
        return item.CriticRating || 0;
      case 'officialRating':
        return item.OfficialRating || '';
      case 'actor':
        return item.People?.filter(p => p.Type === 'Actor').map(p => p.Name) || [];
      case 'studio':
        // Studios array of {Name, Id} or just strings
        if (item.Studios && Array.isArray(item.Studios)) {
          return item.Studios.map(s => typeof s === 'string' ? s : s.Name);
        }
        return [];
      case 'isPlayed':
        return item.UserData?.Played ? 'true' : 'false';
      case 'isUnplayed':
        return item.UserData?.Played ? 'false' : 'true';
      case 'isFavorite':
        return item.UserData?.IsFavorite ? 'true' : 'false';
      case 'isNew':
        return item.IsNew ? 'true' : 'false';
      case 'isMovie':
        return item.Type === 'Movie' ? 'true' : 'false';
      case 'isSeries':
        return item.Type === 'Series' ? 'true' : 'false';
      case 'isKids':
        return item.IsKids ? 'true' : 'false';
      case 'isSports':
        return item.IsSports ? 'true' : 'false';
      case 'title':
        return item.Name || '';
      default:
        return null;
    }
  }

  // ═════════════════════════════════════════════
  // COMPARISON METHODS
  // ═════════════════════════════════════════════

  matchContains(itemValue, searchValue) {
    if (!searchValue) return true;

    // For arrays (genres, actors)
    if (Array.isArray(itemValue)) {
      return itemValue.some(v =>
        v.toLowerCase().includes(searchValue.toLowerCase())
      );
    }

    // For strings
    if (typeof itemValue === 'string') {
      return itemValue.toLowerCase().includes(searchValue.toLowerCase());
    }

    return false;
  }

  matchEquals(itemValue, searchValue) {
    if (!searchValue) return true;

    // For arrays
    if (Array.isArray(itemValue)) {
      return itemValue.some(v => v.toLowerCase() === searchValue.toLowerCase());
    }

    // For strings
    if (typeof itemValue === 'string') {
      return itemValue.toLowerCase() === searchValue.toLowerCase();
    }

    // For numbers
    return itemValue === parseFloat(searchValue);
  }

  matchGreater(itemValue, searchValue) {
    const num = parseFloat(searchValue);
    return itemValue > num;
  }

  matchLess(itemValue, searchValue) {
    const num = parseFloat(searchValue);
    return itemValue < num;
  }

  matchGreaterOrEqual(itemValue, searchValue) {
    const num = parseFloat(searchValue);
    return itemValue >= num;
  }

  matchLessOrEqual(itemValue, searchValue) {
    const num = parseFloat(searchValue);
    return itemValue <= num;
  }

  matchBetween(itemValue, searchValue) {
    // Format: "1980-1989"
    if (typeof searchValue !== 'string') return true;

    const parts = searchValue.split('-');
    if (parts.length !== 2) return true;

    const min = parseFloat(parts[0]);
    const max = parseFloat(parts[1]);

    return itemValue >= min && itemValue <= max;
  }

  matchNot(itemValue, searchValue) {
    // Opposite of contains
    return !this.matchContains(itemValue, searchValue);
  }

  // ═════════════════════════════════════════════
  // VALIDATION
  // ═════════════════════════════════════════════

  validateRule(rule) {
    if (!rule) return { valid: false, error: 'Rule is empty' };
    if (!rule.logic) return { valid: false, error: 'Logic type missing' };
    if (!rule.conditions || rule.conditions.length === 0) {
      return { valid: false, error: 'No conditions defined' };
    }

    return { valid: true };
  }
}

module.exports = RulesEngine;
