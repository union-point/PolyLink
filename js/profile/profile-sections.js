// ============================================
// PROFILE SECTIONS MANAGEMENT
// ============================================
import { Modal, createFormattingToolbar, setupFormattingHandlers } from './profile-modal.js';
import { monthLabel as formatDate, dateRange as formatDateRange, relativeTime as formatTimeAgo,
  notify as showNotification, confirmAction as customConfirm, pending, showError } from '../shared/ui.js';
import { validateForm, initializeValidation } from './profile-validation.js';
import { profiles, posts } from '../services/index.js';
import { escapeHtml as e, safeUrl } from '../shared/content.js';
// Temporary envelope bridges for the not-yet-migrated profile comment renderer.
const getComments = async id => ({ data: await posts.comments.list(id) });
const createComment = async (id, data) => ({ data: { success: true, data: await posts.comments.create(id, data) } });

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

  modal.create('Ավելացնել հավաստագիր', form, (data) => {
    console.log('Certificate added:', data);
    addLicenseEntry(data);
    showNotification('Հավաստագիրը ավելացվել է');
  });
}

/**
 * Add license/certificate entry to the DOM
 * @param {Object} data - License data
 */
function addLicenseEntry(data) {
  const licenseSection = document.querySelector('.licenses-section');
  const newEntry = document.createElement('div');
  newEntry.className = 'item-entry';

  const credentialButton = data.credentialUrl ?
    `<button class="show-cred-btn" onclick="window.open('${data.credentialUrl}', '_blank')">
      Ցուցադրել հավաստագիրը <i class="fas fa-external-link-alt"></i>
    </button>` : '';

  newEntry.innerHTML = `
    <div class="item-logo cert-logo-bg">
      <i class="fas fa-certificate cert-icon"></i>
    </div>
    <div class="item-details">
        <p class="item-title">${data.name || 'Նոր հավաստագիր'}</p>
      <p class="item-subtitle">${data.organization || 'Կազմակերպություն'}</p>
      <p class="item-date">Տրման ամսաթիվը՝ ${formatDate(data.issueDate)}</p>
      ${credentialButton}
    </div>
    <div class="edit-icons">
      <i class="fas fa-pencil-alt edit-icon"></i>
    </div>
  `;

  licenseSection.appendChild(newEntry);
  attachLicenseHandlers(newEntry, data);
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
        value="${currentData.name || ''}"
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
        value="${currentData.organization || ''}"
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
        value="${currentData.issueDate || ''}"
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
        value="${currentData.credentialUrl || ''}"
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

  modal.create('Փոփոխել հավաստագիրը', form, (data) => {
    // Update the entry with new data
    const titleEl = entry.querySelector('.item-title');
    const subtitleEl = entry.querySelector('.item-subtitle');
    const dateEl = entry.querySelector('.item-date');
    const credBtn = entry.querySelector('.show-cred-btn');

    if (titleEl) titleEl.textContent = data.name;
    if (subtitleEl) subtitleEl.textContent = data.organization;
    if (dateEl) dateEl.textContent = `Տրման ամսաթիվը՝ ${formatDate(data.issueDate)}`;

    // Update or add credential button
    if (data.credentialUrl) {
      if (credBtn) {
        credBtn.onclick = () => window.open(data.credentialUrl, '_blank');
      } else {
        const detailsEl = entry.querySelector('.item-details');
        const newBtn = document.createElement('button');
        newBtn.className = 'show-cred-btn';
        newBtn.innerHTML = 'Ցուցադրել հավաստագիրը <i class="fas fa-external-link-alt"></i>';
        newBtn.onclick = () => window.open(data.credentialUrl, '_blank');
        detailsEl.appendChild(newBtn);
      }
    } else if (credBtn) {
      credBtn.remove();
    }

  });

  // Add delete button handler
  setTimeout(() => {
    const deleteBtn = form.querySelector('.delete-entry-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        modal.close();
        deleteLicense(entry);
      });
    }
  }, 100);
}

/**
 * Delete a license entry
 * @param {HTMLElement} entry - License entry element
 */
function deleteLicense(entry) {
  customConfirm("Վստա՞հ եք, որ ցանկանում եք հեռացնել այս հավաստագիրը։")
    .then(answer => {
      if (answer) {
        entry.remove();
        showNotification('Հավաստագիրը հեռացվել է');
      }
    });
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
    editIcon.addEventListener('click', () => editLicense(entry, data));
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
      <select class="visibility-selector" id="category-selector">
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

  modal.create('Ավելացնել հայտարարություն', form, (data) => {
    console.log('Announcement added:', data);
    addAnnouncementEntry(data);
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
  const announcementSection = document.querySelector('.announcements-section');
  const newEntry = document.createElement('div');
  newEntry.className = 'item-entry';
  newEntry.innerHTML = `
    <div class="announcement-card" data-post-id="${data.id || 0}">
      <div class="announcement-content">
        <p><strong>${data.title || 'Նոր հայտարարություն'}</strong>
        ${data.content || 'Բովանդակություն'}
        </p>
      </div>
      <div class="comments-section">
        <button class="btn-comments">Մեկնաբանություններ (0)</button>
        <div class="edit-icons">
          <button class="btn btn-edit primary-btn">Փոփոխել</button>
          <button class="btn btn-delete secondary-btn">Հեռացնել</button>
        </div>
      </div>
    </div>
  `;

  announcementSection.appendChild(newEntry);
  attachAnnouncementHandlers(newEntry);
}

/**
 * Edit an announcement
 * @param {HTMLElement} announcementCard - Announcement card element
 */
function editAnnouncement(announcementCard) {
  const contentEl = announcementCard.querySelector('.announcement-content p');
  const currentTitle = contentEl.querySelector('strong')?.textContent || '';
  const currentContent = contentEl.innerHTML.replace(/<strong>.*?<\/strong>/, '').trim();

  const form = document.createElement('div');
  form.innerHTML = `
    <div style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--font-color-primary);">Վերնագիր</label>
      <input type="text" id="announcement-title" name="title" value="${currentTitle}"
        style="width: 100%; padding: 10px; border-radius: 8px; font-size: 14px; background: var(--card-background); color: var(--font-color-primary); border: 1px solid var(--border-color);">
    </div>
    <div style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--font-color-primary);">Բովանդակություն</label>
      <div id="announcement-content" data-name="content" contenteditable="true"
        style="box-sizing:border-box; width: 100%; min-height: 150px; padding: 10px; border: 1px solid var(--border-color); border-radius: 8px; font-size: 14px; background: var(--card-background); color: var(--font-color-primary);">${currentContent}</div>
    </div>
  `;

  const toolbar = createFormattingToolbar();

  modal.create('Փոփոխել հայտարարությունը', form, (data) => {
    console.log(data);
    contentEl.innerHTML = `<strong>${data.title}</strong> ${data.content}`;
  }, {
    customFooterLeft: toolbar,
    setupFormatting: (modalElement) => setupFormattingHandlers(modalElement)
  });
}

/**
 * Delete an announcement
 * @param {HTMLElement} announcementEntry - Announcement entry element
 */
function deleteAnnouncement(announcementEntry) {
  customConfirm("Վստա՞հ եք, որ ցանկանում եք հեռացնել այս հայտարարությունը։'")
    .then(answer => {
      if (answer) {
        announcementEntry.remove();
        console.log("removed");
      } else {
        console.log("cancelled");
      }
    });
}

/**
 * Toggle comments section for an announcement
 * @param {HTMLElement} announcementCard - Announcement card element
 * @param {HTMLElement} btnComments - Comments button element
 */
async function toggleComments(announcementCard, btnComments) {
  let commentsContainer = announcementCard.querySelector('.comments-container');

  if (!commentsContainer) {
    commentsContainer = await createCommentsContainer(announcementCard, btnComments);
    announcementCard.appendChild(commentsContainer);
  } else {
    if (commentsContainer.style.display === 'none') {
      commentsContainer.style.display = 'block';
    } else {
      commentsContainer.style.display = 'none';
    }
  }
}

/**
 * Create a comment element from comment data
 * @param {Object} comment - Comment data from backend
 * @returns {HTMLElement} Comment element
 */
function createCommentElement(comment) {
  const commentEl = document.createElement('div');
  commentEl.className = 'comment';
  commentEl.style.marginBottom = '12px';

  // Format timestamp
  const timeAgo = formatTimeAgo(comment.createdAt);

  commentEl.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
      <div style="width: 32px; height: 32px; background: var(--border-color); border-radius: 50%; background-image: url('${comment.author?.avatar || ''}'); background-size: cover; background-position: center;"></div>
      <span style="font-weight: 600; font-size: 14px; color: var(--font-color-primary);">${comment.author?.name || 'Անանուն'}</span>
      <span style="font-size: 12px; color: var(--font-color-secondary);">${timeAgo}</span>
    </div>
    <p style="font-size: 14px; margin: 0; padding-left: 32px; color: var(--font-color-primary);">${comment.text}</p>
  `;

  return commentEl;
}

/**
 * Create comments container
 * @param {HTMLElement} announcementCard - Announcement card element
 * @param {HTMLElement} btnComments - Comments button element
 * @returns {HTMLElement} Comments container
 */
async function createCommentsContainer(announcementCard, btnComments) {
  const commentsContainer = document.createElement('div');
  commentsContainer.className = 'comments-container';
  commentsContainer.style.cssText = `
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--border-color);
    animation: fadeIn 0.3s ease;
  `;

  // Comments list container
  const commentsList = document.createElement('div');
  commentsList.className = 'comments-list';
  //load if there is at least one comment

  // Load comments from backend
  try {
    const postId = announcementCard.dataset.postId;
    const response = await getComments(postId);
    const commentsCount = parseInt(btnComments.textContent.match(/\((\d+)\)/)[1]);
    if (response.data && response.data.length > 0 && commentsCount > 0) {
      // Render each comment
      response.data.forEach(comment => {
        const commentEl = createCommentElement(comment);
        commentsList.appendChild(commentEl);
      });

      // Update comment count
      btnComments.textContent = `Մեկնաբանություններ (${response.data.length})`;
    } else {
      // No comments yet
      commentsList.innerHTML = `
        <p style="font-size: 14px; color: var(--font-color-secondary); text-align: center; padding: 16px;">
          Մեկնաբանություններ դեռ չկան
        </p>
      `;
    }
  } catch (error) {
    console.error('Error loading comments:', error);
    commentsList.innerHTML = `
      <p style="font-size: 14px; color: var(--font-color-secondary); text-align: center; padding: 16px;">
        Սխալ՝ մեկնաբանությունները չհաջողվեց բեռնել
      </p>
    `;
  }

  // Add comment form
  const commentForm = createCommentForm(announcementCard, commentsList, btnComments);

  commentsContainer.appendChild(commentsList);
  commentsContainer.appendChild(commentForm);

  return commentsContainer;
}

/**
 * Create comment form
 * @param {HTMLElement} announcementCard - Announcement card element
 * @param {HTMLElement} commentsList - Comments list element
 * @param {HTMLElement} btnComments - Comments button element
 * @returns {HTMLElement} Comment form
 */
function createCommentForm(announcementCard, commentsList, btnComments) {
  const commentForm = document.createElement('div');
  commentForm.style.cssText = `
    display: flex;
    gap: 8px;
    margin-top: 16px;
  `;
  commentForm.innerHTML = `
    <input type="text" placeholder="Գրել մեկնաբանություն..." 
      style="flex: 1; padding: 8px 12px; border-radius: 12px; font-size: 14px; background: var(--card-background); color: var(--font-color-primary);">
    <button class = "primary-btn" style="  color: white; border: none; padding: 8px 16px; border-radius: 20px; cursor: pointer;">
      <i class="fas fa-paper-plane"></i>
    </button>
  `;

  // Handle new comment
  const input = commentForm.querySelector('input');
  const sendBtn = commentForm.querySelector('button');

  const addComment = async () => {
    const text = input.value.trim();
    if (!text) return;

    try {
      const postId = announcementCard.dataset.postId;
      const response = await createComment(postId, { text });
      if (response.data.success) {
        // Clear "no comments yet" message if it exists
        const noCommentsMsg = commentsList.querySelector('p');
        if (noCommentsMsg && noCommentsMsg.textContent.includes('Մեկնաբանություններ դեռ չկան')) {
          commentsList.innerHTML = '';
        }

        // Use the helper function to create comment element
        const newComment = createCommentElement(response.data.data);
        commentsList.appendChild(newComment);
        input.value = '';

        // Update count
        const currentCount = parseInt(btnComments.textContent.match(/\d+/)[0]);
        btnComments.textContent = `Մեկնաբանություններ (${currentCount + 1})`;
      }
    } catch (error) {
      console.error('Error adding comment:', error);
    }
  };

  sendBtn.addEventListener('click', () => addComment());
  input.onkeypress = (e) => {
    if (e.key === 'Enter') addComment();
  };

  return commentForm;
}

/**
 * Attach event handlers to announcement buttons
 * @param {HTMLElement} entry - Announcement entry element
 */
function attachAnnouncementHandlers(entry) {
  const editBtn = entry.querySelector('.btn-edit');
  const deleteBtn = entry.querySelector('.btn-delete');
  const commentsBtn = entry.querySelector('.btn-comments');
  const announcementCard = entry.querySelector('.announcement-card');

  if (editBtn) {
    editBtn.addEventListener('click', () => editAnnouncement(announcementCard));
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => deleteAnnouncement(entry));
  }

  if (commentsBtn) {
    commentsBtn.addEventListener('click', () => toggleComments(announcementCard, commentsBtn));
  }
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
