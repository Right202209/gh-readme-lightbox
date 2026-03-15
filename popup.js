'use strict';

const checkbox = document.getElementById('directOpenLink');

chrome.storage.sync.get({ directOpenLink: false }, (result) => {
  checkbox.checked = result.directOpenLink;
});

checkbox.addEventListener('change', () => {
  chrome.storage.sync.set({ directOpenLink: checkbox.checked });
});
