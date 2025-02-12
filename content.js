(function() {
  console.log('Strava Unit Converter: Content script loaded');

  // Constants for conversion
  const KM_TO_MI = 0.621371;
  const MI_TO_KM = 1.60934;

  // Flag to prevent processing during updates
  let isProcessing = false;

  function findStatElements() {
    // Find all elements that might contain stats to convert
    const selectors = [
      // Main stats
      '.------packages-ui-Stat-Stat-module__statValue--phtGK',  // Main stats
      '[class*="statValue--"]',                                 // Backup for main stats
      
      // Split stats (pace/distance columns)
      '.split-metrics td:not(:first-child)',                    // Split table cells
      '.dense.hoverable td:not(:first-child)',                 // Dense table format
      
      // Inline stats
      '.inline-stats strong',                                   // Inline statistics
      '.more-stats strong',                                     // Additional statistics
      
      // Pace analysis elements
      '#pace-analysis-section .stat-value',                     // Pace analysis section
      '.pace-zones-chart .range',                              // Pace zones
      
      // Best efforts and matched runs
      '.personal-best-stat',                                    // Personal bests
      '.matched-activity-stat',                                 // Matched activities

      // Chart controls - specific to pace/GAP cells
      '#chart-controls td[data-type="pace"]',                  // Average pace cell
      '#chart-controls td[data-type="grade_adjusted_pace"]',   // GAP cell
      '#chart-controls td.gap',                                // GAP display cell
      '#chart-controls tr:last-child td',                      // All average stats row

      // Similar Activities Chart
      '.effort-flag-pace',                                     // Effort flag pace text
      '.effort-flag-diff',                                     // Pace difference text
      '.annotation-pace',                                      // Annotation pace labels
      '.efforts-table .pace-column',                          // Efforts table pace column
      '.y-axis text',                                         // Y-axis pace labels
      '[data-glossary-term="definition-gap"]',                // GAP glossary terms

      // Similar Activities Teaser - More specific selectors
      'div.pace strong',                                      // Direct pace value in teaser
      '.mb-xs.mt-sm.pace strong',                            // Alternative selector for teaser pace
      '#similar-activities-teaser .pace strong'               // Most specific teaser selector
    ];

    // Query for all possible stat elements
    const elements = [];
    selectors.forEach(selector => {
      const found = document.querySelectorAll(selector);
      if (found.length > 0) {
        elements.push(...found);
      }
    });

    return elements;
  }

  function findTextNodesInElement(element) {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    const textNodes = [];
    let node;
    while (node = walker.nextNode()) {
      if (node.nodeValue.trim()) {
        textNodes.push(node);
      }
    }
    return textNodes;
  }

  function convertDistance(value, toMetric) {
    const num = parseFloat(value);
    if (isNaN(num)) return value;
    
    if (toMetric) {
      // miles to km
      return (num * MI_TO_KM).toFixed(2);
    } else {
      // km to miles
      return (num * KM_TO_MI).toFixed(2);
    }
  }

  function convertPace(paceStr, toMetric) {
    const parts = paceStr.trim().split(':');
    if (parts.length !== 2) return paceStr;
    
    const minutes = parseInt(parts[0], 10);
    const seconds = parseInt(parts[1], 10);
    if (isNaN(minutes) || isNaN(seconds)) return paceStr;
    
    const totalSeconds = minutes * 60 + seconds;
    let convertedSeconds;
    
    if (toMetric) {
      // min/mi to min/km - multiply by conversion factor
      convertedSeconds = totalSeconds * MI_TO_KM;
    } else {
      // min/km to min/mi - divide by conversion factor
      convertedSeconds = totalSeconds / KM_TO_MI;
    }
    
    const newMinutes = Math.floor(convertedSeconds / 60);
    const newSeconds = Math.round(convertedSeconds % 60);
    return `${newMinutes}:${newSeconds.toString().padStart(2, '0')}`;
  }

  function determineOriginalUnit(element) {
    // First check for abbr tags
    const abbr = element.querySelector('abbr.unit');
    if (abbr) {
      const text = abbr.textContent.toLowerCase();
      const title = abbr.getAttribute('title')?.toLowerCase() || '';

      // Only consider it a pace or distance if it explicitly has those units
      if (title.includes('minute') && (text.includes('/km') || text.includes('/mi'))) {
        return {
          type: 'pace',
          isMetric: text.includes('/km')
        };
      }
      
      if ((title.includes('mile') || title.includes('kilometer')) && !title.includes('minute')) {
        return {
          type: 'distance',
          isMetric: text.includes('km')
        };
      }
    }

    // If no abbr tag, check the text content but be very specific
    const textContent = element.textContent.toLowerCase();
    if (textContent.match(/\d+:\d+\s*\/(?:km|mi)/)) {  // Matches "4:36/km" or "7:24/mi"
      return {
        type: 'pace',
        isMetric: textContent.includes('/km')
      };
    }

    if (textContent.match(/\d+(?:\.\d+)?\s*(?:km|mi)(?:\s|$)/)) {  // Matches "8.24 km" or "5.12 mi"
      return {
        type: 'distance',
        isMetric: textContent.includes('km')
      };
    }

    return null;
  }

  function updateElement(element, useMetric) {
    // Skip if element was already processed with the same metric setting
    if (element.dataset.currentUnit === String(useMetric)) return;
    
    const originalUnit = determineOriginalUnit(element);
    if (!originalUnit) return;

    const abbr = element.querySelector('abbr.unit');
    let valueNode = null;

    // Find the text node containing the numeric value
    const textNodes = findTextNodesInElement(element);
    for (const node of textNodes) {
      const text = node.textContent.trim();
      if (/^[\d.,]+$/.test(text.replace(/[^\d.,]/g, ''))) {
        valueNode = node;
        break;
      }
    }

    if (!valueNode) return;

    // Store original values if not already stored
    if (!element.dataset.originalValue) {
      element.dataset.originalValue = valueNode.textContent.trim();
      if (abbr) {
        element.dataset.originalAbbrText = abbr.textContent;
        element.dataset.originalAbbrTitle = abbr.getAttribute('title') || '';
      }
      element.dataset.originalIsMetric = String(originalUnit.isMetric);
    }

    // Mark the current unit state
    element.dataset.currentUnit = String(useMetric);

    // If current unit matches original unit, restore original values
    if (useMetric === (element.dataset.originalIsMetric === 'true')) {
      valueNode.textContent = element.dataset.originalValue;
      if (abbr) {
        abbr.textContent = element.dataset.originalAbbrText;
        abbr.setAttribute('title', element.dataset.originalAbbrTitle);
      }
      return;
    }

    // Convert from original value based on original unit
    if (originalUnit.type === 'distance') {
      valueNode.textContent = convertDistance(element.dataset.originalValue, useMetric);
      if (abbr) {
        abbr.textContent = useMetric ? ' km' : ' mi';
        abbr.setAttribute('title', useMetric ? 'kilometers' : 'miles');
      }
    } else if (originalUnit.type === 'pace') {
      valueNode.textContent = convertPace(element.dataset.originalValue, useMetric);
      if (abbr) {
        abbr.textContent = useMetric ? ' /km' : ' /mi';
        abbr.setAttribute('title', useMetric ? 'minutes per kilometer' : 'minutes per mile');
      }
    }
  }

  function processStats(useMetric) {
    console.log('Processing stats, useMetric:', useMetric);
    const elements = findStatElements();
    console.log('Found elements:', elements.length);
    elements.forEach(element => updateElement(element, useMetric));
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'toggleConversion') {
      processStats(message.useMetric);
    }
  });

  // Initial processing using saved preference
  chrome.storage.local.get(['useMetric'], function(result) {
    processStats(result.useMetric || false);
  });

  // Watch for dynamic content updates
  const observer = new MutationObserver((mutations) => {
    if (isProcessing) return;

    // Check if any mutations are relevant to our stat elements
    const hasRelevantChanges = mutations.some(mutation => {
      return Array.from(mutation.addedNodes).some(node => {
        if (node.nodeType !== Node.ELEMENT_NODE) return false;
        
        // Direct matches
        const directMatches = node.matches && (
          node.matches('.------packages-ui-Stat-Stat-module__statValue--phtGK') ||
          node.matches('[class*="statValue--"]') ||
          node.matches('.split-metrics td') ||
          node.matches('.dense.hoverable td') ||
          node.matches('#chart-controls td') ||
          node.matches('.effort-flag-pace') ||
          node.matches('.effort-flag-diff') ||
          node.matches('.annotation-pace') ||
          node.matches('.efforts-table .pace-column') ||
          node.matches('.y-axis text') ||
          node.matches('div.pace strong') ||
          node.matches('.mb-xs.mt-sm.pace strong')
        );

        if (directMatches) return true;

        // Child element matches
        return node.querySelector && (
          node.querySelector('.------packages-ui-Stat-Stat-module__statValue--phtGK') ||
          node.querySelector('[class*="statValue--"]') ||
          node.querySelector('.split-metrics td') ||
          node.querySelector('.dense.hoverable td') ||
          node.querySelector('#chart-controls td[data-type="pace"]') ||
          node.querySelector('#chart-controls td[data-type="grade_adjusted_pace"]') ||
          node.querySelector('#chart-controls td.gap') ||
          node.querySelector('.effort-flag-pace') ||
          node.querySelector('.effort-flag-diff') ||
          node.querySelector('.annotation-pace') ||
          node.querySelector('.efforts-table .pace-column') ||
          node.querySelector('.y-axis text') ||
          node.querySelector('div.pace strong') ||
          node.querySelector('.mb-xs.mt-sm.pace strong')
        );
      });
    });

    if (hasRelevantChanges) {
      chrome.storage.local.get(['useMetric'], function(result) {
        isProcessing = true;
        processStats(result.useMetric || false);
        setTimeout(() => {
          isProcessing = false;
        }, 100);
      });
    }
  });

  // Start observing with a more specific configuration
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: false
  });
})();