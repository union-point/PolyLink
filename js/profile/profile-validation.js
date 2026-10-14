// ============================================
// FORM VALIDATION MODULE
// ============================================

/**
 * Validation rules for different input types
 */
const validationRules = {
    text: {
        minLength: 2,
        maxLength: 255,
        pattern: /^[^\u0000-\u001f]*$/u
    },
    email: {
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    },
    url: {
        pattern: /^https?:\/\/.+/
    },
    month: {
        pattern: /^\d{4}-\d{2}$/
    }
};

/**
 * Validate a single input field
 * @param {HTMLInputElement} input - Input element to validate
 * @returns {boolean} - Whether the input is valid
 */
function validateInput(input) {
    const value = input.value.trim();
    const type = input.type;
    const isRequired = input.hasAttribute('required') || input.hasAttribute('data-required');

    // Clear previous error state
    clearError(input);

    // Check if required field is empty
    if (isRequired && !value) {
        showError(input, 'Այս դաշտը պարտադիր է');
        return false;
    }

    // If not required and empty, it's valid
    if (!value) {
        return true;
    }

    // Validate based on type
    switch (type) {
        case 'text':
            return validateText(input, value);
        case 'email':
            return validateEmail(input, value);
        case 'url':
            return validateUrl(input, value);
        case 'month':
            return validateMonth(input, value);
        default:
            return true;
    }
}

/**
 * Validate text input
 * @param {HTMLInputElement} input - Input element
 * @param {string} value - Input value
 * @returns {boolean} - Whether the input is valid
 */
function validateText(input, value) {
    const rules = validationRules.text;

    if (value.length < rules.minLength) {
        showError(input, `Նվազագույնը ${rules.minLength} նիշ`);
        return false;
    }

    if (value.length > rules.maxLength) {
        showError(input, `Առավելագույնը ${rules.maxLength} նիշ`);
        return false;
    }

    if (!rules.pattern.test(value)) {
        showError(input, 'Անթույլատրելի նիշեր');
        return false;
    }

    return true;
}

/**
 * Validate email input
 * @param {HTMLInputElement} input - Input element
 * @param {string} value - Input value
 * @returns {boolean} - Whether the input is valid
 */
function validateEmail(input, value) {
    if (!validationRules.email.pattern.test(value)) {
        showError(input, 'Անվավер էլ․ հասցե');
        return false;
    }
    return true;
}

/**
 * Validate URL input
 * @param {HTMLInputElement} input - Input element
 * @param {string} value - Input value
 * @returns {boolean} - Whether the input is valid
 */
function validateUrl(input, value) {
    if (!validationRules.url.pattern.test(value)) {
        showError(input, 'Անվավեր URL');
        return false;
    }
    return true;
}

/**
 * Validate month input
 * @param {HTMLInputElement} input - Input element
 * @param {string} value - Input value
 * @returns {boolean} - Whether the input is valid
 */
function validateMonth(input, value) {
    if (!validationRules.month.pattern.test(value)) {
        showError(input, 'Անվավեր ամսաթիվ');
        return false;
    }
    return true;
}

/**
 * Validate contenteditable element
 * @param {HTMLElement} element - Contenteditable element
 * @returns {boolean} - Whether the element is valid
 */
function validateContentEditable(element) {
    const value = element.textContent.trim();
    const minLength = parseInt(element.getAttribute('data-min-length')) || 10;
    const maxLength = parseInt(element.getAttribute('data-max-length')) || 1000;

    clearError(element);

    if (element.hasAttribute('data-required') && !value) {
        showError(element, 'Այս դաշտը պարտադիր է');
        return false;
    }

    if (value && value.length < minLength) {
        showError(element, `Նվազագույնը ${minLength} նիշ`);
        return false;
    }

    if (value && value.length > maxLength) {
        showError(element, `Առավելագույնը ${maxLength} նիշ`);
        return false;
    }

    return true;
}

/**
 * Validate all inputs in a form
 * @param {HTMLElement} form - Form element or container
 * @returns {boolean} - Whether all inputs are valid
 */
function validateForm(form) {
    const inputs = form.querySelectorAll('input, textarea, select');
    const editables = form.querySelectorAll('[contenteditable="true"]');
    let isValid = true;

    // Validate regular inputs
    inputs.forEach(input => {
        if (!validateInput(input)) {
            isValid = false;
        }
    });

    // Validate contenteditable elements
    editables.forEach(element => {
        if (!validateContentEditable(element)) {
            isValid = false;
        }
    });

    return isValid;
}

/**
 * Show error state on input
 * @param {HTMLElement} element - Input element
 * @param {string} message - Error message
 */
function showError(element, message) {
    element.classList.add('input-error');
    element.style.borderColor = '#e74c3c';
    element.style.borderWidth = '2px';

    // Add error message as title for accessibility
    element.setAttribute('title', message);
    element.setAttribute('aria-invalid', 'true');
}

/**
 * Clear error state from input
 * @param {HTMLElement} element - Input element
 */
function clearError(element) {
    element.classList.remove('input-error');
    element.style.borderColor = '';
    element.style.borderWidth = '';
    element.removeAttribute('title');
    element.removeAttribute('aria-invalid');
}

/**
 * Setup real-time validation for an input
 * @param {HTMLInputElement} input - Input element
 */
function setupInputValidation(input) {
    // Validate on blur
    input.addEventListener('blur', () => {
        validateInput(input);
    });

    // Clear error on focus
    input.addEventListener('focus', () => {
        clearError(input);
    });

    // Validate on input (debounced)
    let timeout;
    input.addEventListener('input', () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            validateInput(input);
        }, 500);
    });
}

/**
 * Setup validation for contenteditable element
 * @param {HTMLElement} element - Contenteditable element
 */
function setupContentEditableValidation(element) {
    // Validate on blur
    element.addEventListener('blur', () => {
        validateContentEditable(element);
    });

    // Clear error on focus
    element.addEventListener('focus', () => {
        clearError(element);
    });
}

/**
 * Initialize validation for all inputs in a container
 * @param {HTMLElement} container - Container element
 */
function initializeValidation(container = document) {
    const inputs = container.querySelectorAll('input, textarea, select');
    const editables = container.querySelectorAll('[contenteditable="true"]');

    inputs.forEach(input => setupInputValidation(input));
    editables.forEach(element => setupContentEditableValidation(element));
}

//uncomment
export { setupInputValidation, validateInput, validateContentEditable, setupContentEditableValidation, initializeValidation, validateForm };