document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('toggle');
    const imperialLabel = document.querySelector('.unit-label.imperial');
    const metricLabel = document.querySelector('.unit-label.metric');
    const status = document.getElementById('status');
    
    function updateLabels(isMetric) {
      imperialLabel.classList.toggle('active', !isMetric);
      metricLabel.classList.toggle('active', isMetric);
    }
  
    function showStatus() {
      status.classList.add('visible');
      setTimeout(() => {
        status.classList.remove('visible');
      }, 2000);
    }
  
    // Retrieve the stored conversion preference
    chrome.storage.local.get(['useMetric'], function(result) {
      const useMetric = result.useMetric || false;
      toggle.checked = useMetric;
      updateLabels(useMetric);
    });
    
    // When the toggle changes, store the new value and send a message to the active tab
    toggle.addEventListener('change', () => {
      const useMetric = toggle.checked;
      
      // Update UI
      updateLabels(useMetric);
      showStatus();
      
      // Store the preference
      chrome.storage.local.set({ useMetric }, () => {
        // Query for the active tab
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0] && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, { 
              action: "toggleConversion", 
              useMetric 
            }).catch(error => {
              console.log('Error sending message to content script:', error);
            });
          }
        });
      });
    });
  });