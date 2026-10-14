// ============================================
// PROFILE SECTIONS MANAGEMENT
// ============================================
import { Modal, createFormattingToolbar, setupFormattingHandlers } from './profile-modal.js';
import { monthLabel as formatDate, dateRange as formatDateRange, relativeTime as formatTimeAgo,
  notify as showNotification, confirmAction as customConfirm, pending, showError } from '../shared/ui.js';
import { validateForm, initializeValidation } from './profile-validation.js';
import { profiles, posts } from '../services/index.js';
import { certificateEntry, announcementEntry } from './profile-render.js';
import { escapeHtml as e, safeUrl, sanitizeHtml } from '../shared/content.js';
const modal = new Modal();

// ============================================
// EDUCATION SECTION
// ============================================

/**
 * Show modal to add education entry
 */
function showAddEducationModal() {
  const form = document.createElement('div');
  form.innerHTML = `
    <div style=" padding: 24px; margin: -24px -24px 0 -24px; border-radius: 12px 12px 0 0;">
      <div style="display: flex; align-items: center; gap: 16px;">
        <div style="width: 56px; height: 56px; background: #667eea; border-radius: 16px; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(10px);">
          <i class="fas fa-graduation-cap" style="font-size: 28px; color: var(--card-background);"></i>
        </div>
        <div>
          <h3 style="margin: 0; color: var(--font-color-primary); font-size: 20px; font-weight: 700;">Ավելացնել կրթություն</h3>
          <p style="margin: 4px 0 0 0; color: var(--font-color-secondary); font-size: 14px;">Լրացրեք ձեր կրթական տվյալները</p>
        </div>
      </div>
    </div>
    
    <div style="margin-bottom: 20px;">
      <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-weight: 600; color: var(--font-color-primary); font-size: 14px;">
        <i class="fas fa-university" style="color: #667eea; font-size: 16px;"></i>
        Ուսումնական հաստատություն 
        <span style="color: #e74c3c; font-size: 16px;">*</span>
      </label>
      <input type="text" id="edu-institution" name="institution" required data-required
        style="width: 100%; padding: 14px 16px; border-radius: 12px; font-size: 15px; background: var(--card-background); color: var(--font-color-primary); border: 2px solid var(--border-color); transition: all 0.3s ease; box-sizing: border-box;"
        placeholder="Օրինակ՝ Հայաստանի ազգային պոլիտեխնիկական համալսարան"
        onfocus="this.style.borderColor='#667eea'; this.style.boxShadow='0 0 0 4px rgba(102, 126, 234, 0.1)'"
        onblur="this.style.borderColor='var(--border-color)'; this.style.boxShadow='none'">
    </div>
    
    <div style="margin-bottom: 20px;">
      <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-weight: 600; color: var(--font-color-primary); font-size: 14px;">
        <i class="fas fa-award" style="color: #667eea; font-size: 16px;"></i>
        Աստիճան և մասնագիտություն 
        <span style="color: #e74c3c; font-size: 16px;">*</span>
      </label>
      <input type="text" id="edu-degree" name="degree" required data-required
        style="width: 100%; padding: 14px 16px; border-radius: 12px; font-size: 15px; background: var(--card-background); color: var(--font-color-primary); border: 2px solid var(--border-color); transition: all 0.3s ease; box-sizing: border-box;"
        placeholder="Օրինակ՝ Բակալավրի աստիճան, Ծրագրային ինժեներություն"
        onfocus="this.style.borderColor='#667eea'; this.style.boxShadow='0 0 0 4px rgba(102, 126, 234, 0.1)'"
        onblur="this.style.borderColor='var(--border-color)'; this.style.boxShadow='none'">
    </div>
    
    <div style="background: var(--window-background); padding: 16px; border-radius: 12px; margin-bottom: 20px;">
      <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px; font-weight: 600; color: var(--font-color-primary); font-size: 14px;">
        <i class="fas fa-calendar-alt" style="color: #667eea; font-size: 16px;"></i>
        Ժամանակահատված
      </label>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div>
          <label style="display: block; margin-bottom: 8px; font-size: 13px; color: var(--font-color-secondary); font-weight: 500;">
            Սկիզբ <span style="color: #e74c3c;">*</span>
          </label>
          <input type="month" id="edu-start" name="startDate" required data-required
            style="width: 100%; padding: 12px; border-radius: 10px; font-size: 14px; background: var(--card-background); color: var(--font-color-primary); border: 2px solid var(--border-color); transition: all 0.3s ease; box-sizing: border-box;"
            onfocus="this.style.borderColor='#667eea'; this.style.boxShadow='0 0 0 4px rgba(102, 126, 234, 0.1)'"
            onblur="this.style.borderColor='var(--border-color)'; this.style.boxShadow='none'">
        </div>
        <div>
          <label style="display: block; margin-bottom: 8px; font-size: 13px; color: var(--font-color-secondary); font-weight: 500;">
            Ավարտ
          </label>
          <input type="month" id="edu-end" name="endDate"
            style="width: 100%; padding: 12px; border-radius: 10px; font-size: 14px; background: var(--card-background); color: var(--font-color-primary); border: 2px solid var(--border-color); transition: all 0.3s ease; box-sizing: border-box;"
            onfocus="this.style.borderColor='#667eea'; this.style.boxShadow='0 0 0 4px rgba(102, 126, 234, 0.1)'"
            onblur="this.style.borderColor='var(--border-color)'; this.style.boxShadow='none'">
        </div>
      </div>
    </div>
    
    <div style="background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%); padding: 12px 16px; border-radius: 10px; border-left: 4px solid #667eea;">
      <p style="margin: 0; font-size: 13px; color: var(--font-color-secondary); line-height: 1.5;">
        <i class="fas fa-info-circle" style="color: #667eea; margin-right: 8px;"></i>
        Լրացրեք բոլոր պարտադիր դաշտերը՝ նշված աստղանիշով (*)
      </p>
    </div>
  `;

  modal.create('Ավելացնել կրթություն', form, async data => {
    if (!validateForm(form)) return false;
    const record = await profiles.education.create(data);
    addEducationEntry(record);
    showNotification('Կրթությունը ավելացվել է');
  });

  // Initialize validation for form inputs
  setTimeout(() => {
    initializeValidation(form);

  }, 100);
}

/**
 * Add education entry to the DOM
 * @param {Object} data - Education data
 */
function addEducationEntry(data) {
  const educationSection = document.querySelector('.education-section');
  const newEntry = document.createElement('div');
  newEntry.className = 'item-entry';
  newEntry.dataset.entryId = data.id;
  newEntry.innerHTML = `
    <div class="item-logo">
      ${data.logo ? `<img src="${e(safeUrl(data.logo, { image: true }))}" class="entry-logo" alt="University Logo">` : `<div class="cert-logo-bg" style="width: 48px; height: 48px; display: flex; align-items: center; justify-content: center;">
        <i class="fas fa-graduation-cap" style="color: white; font-size: 20px;"></i>
      </div>`}
    </div>
    <div class="item-details">
      <p class="item-title">${e(data.institution || 'Նոր ուսումնական հաստատություն')}</p>
      <p class="item-subtitle">${e(data.degree || 'Աստիճան և մասնագիտություն')}</p>
      <p class="item-date">${formatDateRange(data.startDate, data.endDate)}</p>
    </div>
    <div class="edit-icons">
      <i class="fas fa-pencil-alt edit-icon"></i>
    </div>
  `;
  educationSection.appendChild(newEntry);
  attachEducationHandlers(newEntry, data);
}

/**
 * Edit an education entry
 * @param {HTMLElement} entry - Education entry element
 * @param {Object} currentData - Current education data
 */
function editEducation(entry, currentData) {
  const form = document.createElement('div');
  form.innerHTML = `
    <div style=" padding: 24px; margin: -24px -24px 0 -24px; border-radius: 12px 12px 0 0;">
      <div style="display: flex; align-items: center; gap: 16px;">
        <div style="width: 56px; height: 56px; background: #667eea; border-radius: 16px; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(10px);">
          <i class="fas fa-graduation-cap" style="font-size: 28px; color: var(--card-background);"></i>
        </div>
        <div>
          <h3 style="margin: 0; color: var(--font-color-primary); font-size: 20px; font-weight: 700;">Փոփոխել կրթությունը</h3>
          <p style="margin: 4px 0 0 0; color: var(--font-color-secondary); font-size: 14px;">Թարմացրեք ձեր կրթական տվյալները</p>
        </div>
      </div>
    </div>
    
    <div style="margin-bottom: 20px;">
      <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-weight: 600; color: var(--font-color-primary); font-size: 14px;">
        <i class="fas fa-university" style="color: #667eea; font-size: 16px;"></i>
        Ուսումնական հաստատություն 
        <span style="color: #e74c3c; font-size: 16px;">*</span>
      </label>
      <input type="text" id="edu-institution" name="institution" required data-required
        value="${e(currentData.institution || '')}"
        style="width: 100%; padding: 14px 16px; border-radius: 12px; font-size: 15px; background: var(--card-background); color: var(--font-color-primary); border: 2px solid var(--border-color); transition: all 0.3s ease; box-sizing: border-box;"
        placeholder="Օրինակ՝ Հայաստանի ազգային պոլիտեխնիկական համալսարան"
        onfocus="this.style.borderColor='#667eea'; this.style.boxShadow='0 0 0 4px rgba(102, 126, 234, 0.1)'"
        onblur="this.style.borderColor='var(--border-color)'; this.style.boxShadow='none'">
    </div>
    
    <div style="margin-bottom: 20px;">
      <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-weight: 600; color: var(--font-color-primary); font-size: 14px;">
        <i class="fas fa-award" style="color: #667eea; font-size: 16px;"></i>
        Աստիճան և մասնագիտություն 
        <span style="color: #e74c3c; font-size: 16px;">*</span>
      </label>
      <input type="text" id="edu-degree" name="degree" required data-required
        value="${e(currentData.degree || '')}"
        style="width: 100%; padding: 14px 16px; border-radius: 12px; font-size: 15px; background: var(--card-background); color: var(--font-color-primary); border: 2px solid var(--border-color); transition: all 0.3s ease; box-sizing: border-box;"
        placeholder="Օրինակ՝ Բակալավրի աստիճան, Ծրագրային ինժեներություն"
        onfocus="this.style.borderColor='#667eea'; this.style.boxShadow='0 0 0 4px rgba(102, 126, 234, 0.1)'"
        onblur="this.style.borderColor='var(--border-color)'; this.style.boxShadow='none'">
    </div>
    
    <div style="background: var(--window-background); padding: 16px; border-radius: 12px; margin-bottom: 20px;">
      <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px; font-weight: 600; color: var(--font-color-primary); font-size: 14px;">
        <i class="fas fa-calendar-alt" style="color: #667eea; font-size: 16px;"></i>
        Ժամանակահատված
      </label>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div>
          <label style="display: block; margin-bottom: 8px; font-size: 13px; color: var(--font-color-secondary); font-weight: 500;">
            Սկիզբ <span style="color: #e74c3c;">*</span>
          </label>
          <input type="month" id="edu-start" name="startDate" required data-required
            value="${e(currentData.startDate || '')}"
            style="width: 100%; padding: 12px; border-radius: 10px; font-size: 14px; background: var(--card-background); color: var(--font-color-primary); border: 2px solid var(--border-color); transition: all 0.3s ease; box-sizing: border-box;"
            onfocus="this.style.borderColor='#667eea'; this.style.boxShadow='0 0 0 4px rgba(102, 126, 234, 0.1)'"
            onblur="this.style.borderColor='var(--border-color)'; this.style.boxShadow='none'">
        </div>
        <div>
          <label style="display: block; margin-bottom: 8px; font-size: 13px; color: var(--font-color-secondary); font-weight: 500;">
            Ավարտ
          </label>
          <input type="month" id="edu-end" name="endDate"
            value="${e(currentData.endDate || '')}"
            style="width: 100%; padding: 12px; border-radius: 10px; font-size: 14px; background: var(--card-background); color: var(--font-color-primary); border: 2px solid var(--border-color); transition: all 0.3s ease; box-sizing: border-box;"
            onfocus="this.style.borderColor='#667eea'; this.style.boxShadow='0 0 0 4px rgba(102, 126, 234, 0.1)'"
            onblur="this.style.borderColor='var(--border-color)'; this.style.boxShadow='none'">
        </div>
      </div>
    </div>
    
    <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border-color);">
      <button type="button" class="delete-entry-btn" style="width: 100%; padding: 12px; background: #e74c3c; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.3s ease;">
        <i class="fas fa-trash-alt" style="margin-right: 8px;"></i>
        Հեռացնել կրթությունը
      </button>
    </div>
  `;

  modal.create('Փոփոխել կրթությունը', form, async data => {
    if (!validateForm(form)) return false;
    const record = await profiles.education.update(currentData.id, { ...currentData, ...data });
    Object.assign(currentData, record);
    // Update the entry with new data
    const titleEl = entry.querySelector('.item-title');
    const subtitleEl = entry.querySelector('.item-subtitle');
    const dateEl = entry.querySelector('.item-date');

    if (titleEl) titleEl.textContent = data.institution;
    if (subtitleEl) subtitleEl.textContent = data.degree;
    if (dateEl) dateEl.textContent = formatDateRange(data.startDate, data.endDate);

    showNotification('Կրթությունը թարմացվել է');
  });

  // Add delete button handler
  setTimeout(() => {
    const deleteBtn = form.querySelector('.delete-entry-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        deleteEducation(entry, currentData.id, deleteBtn, form);
      });
    }

    initializeValidation(form);

  }, 100);
}

/**
 * Delete an education entry
 * @param {HTMLElement} entry - Education entry element
 */
async function deleteEducation(entry, id, button, form) {
  if (button.disabled) return;
  button.disabled = true;
  const confirmed = await customConfirm('Վստա՞հ եք, որ ցանկանում եք հեռացնել այս կրթությունը։');
  button.disabled = false;
  if (!confirmed) return;
  modal.saving = true;
  const saved = await pending(button, form, () => profiles.education.delete(id));
  modal.saving = false;
  if (saved) { entry.remove(); modal.close(); showNotification('Կրթությունը հեռացվել է'); }
}

/**
 * Attach event handlers to education entry buttons
 * @param {HTMLElement} entry - Education entry element
 * @param {Object} data - Education data
 */
function attachEducationHandlers(entry, data) {
  const editIcon = entry.querySelector('.fa-pencil-alt');

  if (editIcon) {
    editIcon.style.cursor = 'pointer';
    editIcon.tabIndex = 0; editIcon.setAttribute('role', 'button'); editIcon.setAttribute('aria-label', 'Փոփոխել կրթությունը');
    editIcon.onclick = () => editEducation(entry, data);
  }
}

// ============================================
// LICENSE/CERTIFICATE SECTION
// ============================================

/**
 * Show modal to add license/certificate entry
 */
function showAddLicenseModal() {
  const form = document.createElement('div');
  form.innerHTML = `
    <div style=" padding: 24px; margin: -24px -24px 24px -24px; border-radius: 12px 12px 0 0;">
      <div style="display: flex; align-items: center; gap: 16px;">
        <div style="width: 56px; height: 56px; background: #f5576c; border-radius: 16px; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(10px);">
          <i class="fas fa-certificate" style="font-size: 28px; color: white;"></i>
        </div>
        <div>
          <h3 style="margin: 0; color: var(--font-color-primary); font-size: 20px; font-weight: 700;">Ավելացնել հավաստագիր</h3>
          <p style="margin: 4px 0 0 0; color: var(--font-color-secondary); font-size: 14px;">Լրացրեք ձեր հավաստագրի տվյալները</p>
        </div>
      </div>
    </div>
    
    <div style="margin-bottom: 20px;">
      <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-weight: 600; color: var(--font-color-primary); font-size: 14px;">
        <i class="fas fa-award" style="color: #f5576c; font-size: 16px;"></i>
        Հավաստագրի անվանում
      </label>
      <input type="text" id="cert-name" name="name" 
        style="width: 100%; padding: 14px 16px; border-radius: 12px; font-size: 15px; background: var(--card-background); color: var(--font-color-primary); border: 2px solid var(--border-color); transition: all 0.3s ease; box-sizing: border-box;"
        placeholder="Օրինակ՝ Python Ծրագրավորում"
        onfocus="this.style.borderColor='#f5576c'; this.style.boxShadow='0 0 0 4px rgba(245, 87, 108, 0.1)'"
        onblur="this.style.borderColor='var(--border-color)'; this.style.boxShadow='none'">
    </div>
    
    <div style="margin-bottom: 20px;">
      <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-weight: 600; color: var(--font-color-primary); font-size: 14px;">
        <i class="fas fa-building" style="color: #f5576c; font-size: 16px;"></i>
        Կազմակերպություն
      </label>
      <input type="text" id="cert-org" name="organization" 
        style="width: 100%; padding: 14px 16px; border-radius: 12px; font-size: 15px; background: var(--card-background); color: var(--font-color-primary); border: 2px solid var(--border-color); transition: all 0.3s ease; box-sizing: border-box;"
        placeholder="Օրինակ՝ Armenian Code Academy"
        onfocus="this.style.borderColor='#f5576c'; this.style.boxShadow='0 0 0 4px rgba(245, 87, 108, 0.1)'"
        onblur="this.style.borderColor='var(--border-color)'; this.style.boxShadow='none'">
    </div>
    
    <div style="background: var(--window-background); padding: 16px; border-radius: 12px; margin-bottom: 20px;">
      <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-weight: 600; color: var(--font-color-primary); font-size: 14px;">
        <i class="fas fa-calendar-check" style="color: #f5576c; font-size: 16px;"></i>
        Տրման ամսաթիվ
      </label>
      <input type="month" id="cert-date" name="issueDate" 
        style="width: 100%; padding: 12px; border-radius: 10px; font-size: 14px; background: var(--card-background); color: var(--font-color-primary); border: 2px solid var(--border-color); transition: all 0.3s ease; box-sizing: border-box;"
        onfocus="this.style.borderColor='#f5576c'; this.style.boxShadow='0 0 0 4px rgba(245, 87, 108, 0.1)'"
        onblur="this.style.borderColor='var(--border-color)'; this.style.boxShadow='none'">
    </div>
    
    <div style="margin-bottom: 20px;">
      <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-weight: 600; color: var(--font-color-primary); font-size: 14px;">
        <i class="fas fa-link" style="color: #f5576c; font-size: 16px;"></i>
        Հավաստագրի հղում
        <span style="font-size: 12px; color: var(--font-color-secondary); font-weight: 400; margin-left: 4px;">(ոչ պարտադիր)</span>
      </label>
      <input type="url" id="cert-url" name="credentialUrl" 
        style="width: 100%; padding: 14px 16px; border-radius: 12px; font-size: 15px; background: var(--card-background); color: var(--font-color-primary); border: 2px solid var(--border-color); transition: all 0.3s ease; box-sizing: border-box;"
        placeholder="https://..."
        onfocus="this.style.borderColor='#f5576c'; this.style.boxShadow='0 0 0 4px rgba(245, 87, 108, 0.1)'"
        onblur="this.style.borderColor='var(--border-color)'; this.style.boxShadow='none'">
    </div>
    
    <div style="background: linear-gradient(135deg, rgba(240, 147, 251, 0.1) 0%, rgba(245, 87, 108, 0.1) 100%); padding: 12px 16px; border-radius: 10px; border-left: 4px solid #f5576c;">
      <p style="margin: 0; font-size: 13px; color: var(--font-color-secondary); line-height: 1.5;">
        <i class="fas fa-lightbulb" style="color: #f5576c; margin-right: 8px;"></i>
        Ավելացրեք հավաստագրի հղումը՝ այլ օգտատերերին հնարավորություն տալու դիտել այն
      </p>
    </div>
  `;

  modal.create('Ավելացնել հավաստագիր', form, async data => {
    addLicenseEntry(await profiles.certificates.create(data));
    showNotification('Հավաստագիրը ավելացվել է');
  });
}

/**
 * Add license/certificate entry to the DOM
 * @param {Object} data - License data
 */
function addLicenseEntry(data) {
  const entry = certificateEntry(data, true);
  document.querySelector('.licenses-section').appendChild(entry);
  attachLicenseHandlers(entry, data);
}

/**
 * Edit a license entry
 * @param {HTMLElement} entry - License entry element
 * @param {Object} currentData - Current license data
 */
function editLicense(entry, currentData) {
  const form = document.createElement('div');
  form.innerHTML = `
    <div style=" padding: 24px; margin: -24px -24px 24px -24px; border-radius: 12px 12px 0 0;">
      <div style="display: flex; align-items: center; gap: 16px;">
        <div style="width: 56px; height: 56px; background: #f5576c; border-radius: 16px; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(10px);">
          <i class="fas fa-certificate" style="font-size: 28px; color: white;"></i>
        </div>
        <div>
          <h3 style="margin: 0; color: var(--font-color-primary); font-size: 20px; font-weight: 700;">Փոփոխել հավաստագիրը</h3>
          <p style="margin: 4px 0 0 0; color: var(--font-color-secondary); font-size: 14px;">Թարմացրեք ձեր հավաստագրի տվյալները</p>
        </div>
      </div>
    </div>
    
    <div style="margin-bottom: 20px;">
      <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-weight: 600; color: var(--font-color-primary); font-size: 14px;">
        <i class="fas fa-award" style="color: #f5576c; font-size: 16px;"></i>
        Հավաստագրի անվանում
      </label>
      <input type="text" id="cert-name" name="name" 
        value="${e(currentData.name || '')}"
        style="width: 100%; padding: 14px 16px; border-radius: 12px; font-size: 15px; background: var(--card-background); color: var(--font-color-primary); border: 2px solid var(--border-color); transition: all 0.3s ease; box-sizing: border-box;"
        placeholder="Օրինակ՝ Python Ծրագրավորում"
        onfocus="this.style.borderColor='#f5576c'; this.style.boxShadow='0 0 0 4px rgba(245, 87, 108, 0.1)'"
        onblur="this.style.borderColor='var(--border-color)'; this.style.boxShadow='none'">
    </div>
    
    <div style="margin-bottom: 20px;">
      <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-weight: 600; color: var(--font-color-primary); font-size: 14px;">
        <i class="fas fa-building" style="color: #f5576c; font-size: 16px;"></i>
        Կազմակերպություն
      </label>
      <input type="text" id="cert-org" name="organization" 
        value="${e(currentData.organization || '')}"
        style="width: 100%; padding: 14px 16px; border-radius: 12px; font-size: 15px; background: var(--card-background); color: var(--font-color-primary); border: 2px solid var(--border-color); transition: all 0.3s ease; box-sizing: border-box;"
        placeholder="Օրինակ՝ Armenian Code Academy"
        onfocus="this.style.borderColor='#f5576c'; this.style.boxShadow='0 0 0 4px rgba(245, 87, 108, 0.1)'"
        onblur="this.style.borderColor='var(--border-color)'; this.style.boxShadow='none'">
    </div>
    
    <div style="background: var(--window-background); padding: 16px; border-radius: 12px; margin-bottom: 20px;">
      <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-weight: 600; color: var(--font-color-primary); font-size: 14px;">
        <i class="fas fa-calendar-check" style="color: #f5576c; font-size: 16px;"></i>
        Տրման ամսաթիվ
      </label>
      <input type="month" id="cert-date" name="issueDate" 
        value="${e(currentData.issueDate || '')}"
        style="width: 100%; padding: 12px; border-radius: 10px; font-size: 14px; background: var(--card-background); color: var(--font-color-primary); border: 2px solid var(--border-color); transition: all 0.3s ease; box-sizing: border-box;"
        onfocus="this.style.borderColor='#f5576c'; this.style.boxShadow='0 0 0 4px rgba(245, 87, 108, 0.1)'"
        onblur="this.style.borderColor='var(--border-color)'; this.style.boxShadow='none'">
    </div>
    
    <div style="margin-bottom: 20px;">
      <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-weight: 600; color: var(--font-color-primary); font-size: 14px;">
        <i class="fas fa-link" style="color: #f5576c; font-size: 16px;"></i>
        Հավաստագրի հղում
        <span style="font-size: 12px; color: var(--font-color-secondary); font-weight: 400; margin-left: 4px;">(ոչ պարտադիր)</span>
      </label>
      <input type="url" id="cert-url" name="credentialUrl" 
        value="${e(currentData.credentialUrl || '')}"
        style="width: 100%; padding: 14px 16px; border-radius: 12px; font-size: 15px; background: var(--card-background); color: var(--font-color-primary); border: 2px solid var(--border-color); transition: all 0.3s ease; box-sizing: border-box;"
        placeholder="https://..."
        onfocus="this.style.borderColor='#f5576c'; this.style.boxShadow='0 0 0 4px rgba(245, 87, 108, 0.1)'"
        onblur="this.style.borderColor='var(--border-color)'; this.style.boxShadow='none'">
    </div>
    
    <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border-color);">
      <button type="button" class="delete-entry-btn" style="width: 100%; padding: 12px; background: #e74c3c; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.3s ease;">
        <i class="fas fa-trash-alt" style="margin-right: 8px;"></i>
        Հեռացնել հավաստագիրը
      </button>
    </div>
  `;

  modal.create('Փոփոխել հավաստագիրը', form, async data => {
    const saved = await profiles.certificates.update(currentData.id, { ...currentData, ...data });
    const replacement = certificateEntry(saved, true); entry.replaceWith(replacement);
    attachLicenseHandlers(replacement, saved);
    showNotification('Հավաստագիրը թարմացվել է');
  });

  // Add delete button handler
  setTimeout(() => {
    const deleteBtn = form.querySelector('.delete-entry-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        deleteLicense(entry, currentData.id, deleteBtn, form);
      });
    }
  }, 100);
}

/**
 * Delete a license entry
 * @param {HTMLElement} entry - License entry element
 */
async function deleteLicense(entry, id, button, form) {
  if (button.disabled) return;
  button.disabled = true;
  const confirmed = await customConfirm('Վստա՞հ եք, որ ցանկանում եք հեռացնել այս հավաստագիրը։');
  button.disabled = false;
  if (!confirmed) return;
  modal.saving = true;
  const saved = await pending(button, form, () => profiles.certificates.delete(id));
  modal.saving = false;
  if (saved) { entry.remove(); modal.close(); showNotification('Հավաստագիրը հեռացվել է'); }
}

/**
 * Attach event handlers to license entry buttons
 * @param {HTMLElement} entry - License entry element
 * @param {Object} data - License data
 */
function attachLicenseHandlers(entry, data) {
  const editIcon = entry.querySelector('.fa-pencil-alt');
  if (editIcon) {
    editIcon.style.cursor = 'pointer';
    editIcon.onclick = () => editLicense(entry, data);
  }
}

// ============================================
// ANNOUNCEMENTS SECTION
// ============================================

/**
 * Show modal to add announcement
 */
function showAddAnnouncementModal() {
  const form = document.createElement('div');
  form.innerHTML = `
    <div style=" margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--font-color-primary);">Կատեգորիա</label>
      <select class="visibility-selector" id="category-selector" name="category">
        <option value="job">Աշխատանք</option>
        <option value="internship">Պրակտիկա</option>
        <option value="training">Դասընթաց</option>
      </select>
    </div>
    <div style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--font-color-primary);">Վերնագիր</label>
      <input type="text" id="announcement-title" name="title" 
        style="box-sizing:border-box; width: 100%; padding: 10px; border-radius: 8px; font-size: 14px; background: var(--card-background); color: var(--font-color-primary); border: 1px solid var(--border-color);"
        placeholder="Օրինակ՝ Աշխատանքային հնարավորություն">
    </div>
    <div style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--font-color-primary);">Բովանդակություն</label>
      <div id="announcement-content" data-name="content" contenteditable="true"
        style="box-sizing:border-box; width: 100%; min-height: 150px; padding: 10px; border: 1px solid var(--border-color); border-radius: 8px; font-size: 14px; background: var(--card-background); color: var(--font-color-primary);"
        data-placeholder="Մուտքագրեք հայտարարության բովանդակությունը..."></div>
    </div>
  `;

  const toolbar = createFormattingToolbar();

  modal.create('Ավելացնել հայտարարություն', form, async data => {
    addAnnouncementEntry(await posts.create(data));
    showNotification('Հայտարարությունը ավելացվել է');
  }, {
    customFooterLeft: toolbar,
    setupFormatting: (modalElement) => setupFormattingHandlers(modalElement)
  });
}

/**
 * Add announcement entry to the DOM
 * @param {Object} data - Announcement data
 */
function addAnnouncementEntry(data) {
  const section = document.querySelector('.announcements-section');
  if ([...section.querySelectorAll('.announcement-card')].some(card => card.dataset.postId === data.id)) return;
  const entry = announcementEntry(data, true);
  document.querySelector('.announcements-section [data-announcement-state]')?.remove();
  document.querySelector('.announcements-section').appendChild(entry);
  attachAnnouncementHandlers(entry);
}

/**
 * Edit an announcement
 * @param {HTMLElement} announcementCard - Announcement card element
 */
function editAnnouncement(announcementCard) {
  const contentEl = announcementCard.querySelector('.announcement-content p');
  const record = announcementCard.record;
  const currentTitle = record.title;
  const currentContent = record.content;

  const form = document.createElement('div');
  form.innerHTML = `
    <div style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--font-color-primary);">Վերնագիր</label>
      <input type="text" id="announcement-title" name="title" value="${e(currentTitle)}"
        style="width: 100%; padding: 10px; border-radius: 8px; font-size: 14px; background: var(--card-background); color: var(--font-color-primary); border: 1px solid var(--border-color);">
    </div>
    <div style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--font-color-primary);">Բովանդակություն</label>
      <div id="announcement-content" data-name="content" contenteditable="true"
        style="box-sizing:border-box; width: 100%; min-height: 150px; padding: 10px; border: 1px solid var(--border-color); border-radius: 8px; font-size: 14px; background: var(--card-background); color: var(--font-color-primary);">${sanitizeHtml(currentContent)}</div>
    </div>
  `;

  const toolbar = createFormattingToolbar();

  modal.create('Փոփոխել հայտարարությունը', form, async data => {
    const saved = await posts.update(record.id, { ...record, ...data });
    const entry = announcementEntry(saved, true); announcementCard.closest('.item-entry').replaceWith(entry);
    attachAnnouncementHandlers(entry);
  }, {
    customFooterLeft: toolbar,
    setupFormatting: (modalElement) => setupFormattingHandlers(modalElement)
  });
}

/**
 * Delete an announcement
 * @param {HTMLElement} announcementEntry - Announcement entry element
 */
async function deleteAnnouncement(entry) {
  const button = entry.querySelector('.btn-delete');
  if (button.disabled) return;
  button.disabled = true;
  const confirmed = await customConfirm('Վստա՞հ եք, որ ցանկանում եք հեռացնել այս հայտարարությունը։');
  button.disabled = false;
  if (!confirmed) return;
  await pending(button, entry, async () => { await posts.delete(entry.querySelector('.announcement-card').dataset.postId); entry.remove(); });
}

function attachAnnouncementHandlers(entry) {
  const card = entry.querySelector('.announcement-card');
  entry.querySelector('.btn-edit').onclick = () => editAnnouncement(card);
  entry.querySelector('.btn-delete').onclick = () => deleteAnnouncement(entry);
}

// ============================================
// PHOTO UPLOAD
// ============================================

/**
 * Handle banner photo upload
 */
function handleBannerUpload() { uploadPhoto('cover'); }
function handleProfilePhotoUpload() { uploadPhoto('avatar'); }
function uploadPhoto(kind) {
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp,image/gif';
  input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    const container = document.querySelector('.intro-card');
    await pending(null, container, async () => {
      const user = await profiles.upload(kind, file);
      if (kind === 'cover') document.querySelector('.banner-photo').style.backgroundImage = `url("${safeUrl(user.cover, { image: true })}")`;
      else document.querySelector('.profile-photo img').src = safeUrl(user.avatar, { image: true });
      showNotification('Լուսանկարը թարմացվել է');
    });
  };
  input.click();
}

export { showAddEducationModal, addEducationEntry, attachEducationHandlers,
 showAddLicenseModal, addLicenseEntry, attachLicenseHandlers,
 showAddAnnouncementModal, addAnnouncementEntry, attachAnnouncementHandlers,
 handleBannerUpload, handleProfilePhotoUpload };
