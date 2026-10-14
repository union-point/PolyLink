// import { registerUser, login } from "./api/auth-api.js"; //---!!!- for testing without  server ---!!!- 

document.addEventListener('DOMContentLoaded', () => {
    const PasswordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirm');
    const emailInput = document.getElementById('email');
    const firstNameInput = document.getElementById('firstname');
    const lastNameInput = document.getElementById('lastname');

    const submitBtn = document.getElementById('submit-btn');
    const strengthBar = document.getElementById('strength-bar');
    const strengthText = document.getElementById('strength-text');
    const errorMessage = document.querySelector('.error-message');


    // Toggle password visibility
    document.getElementById('toggle-new').addEventListener('click', function () {
        const type = PasswordInput.type === 'password' ? 'text' : 'password';
        PasswordInput.type = type;
        this.textContent = type === 'password' ? '👁️' : '🙈';
    });
    document.getElementById('toggle-confirm').addEventListener('click', function () {
        const type = confirmPasswordInput.type === 'password' ? 'text' : 'password';
        confirmPasswordInput.type = type;
        this.textContent = type === 'password' ? '👁️' : '🙈';
    });

    // Password validation requirements
    const requirements = {
        length: { regex: /.{8,}/, element: document.getElementById('req-length') },
        uppercase: { regex: /[A-Z]/, element: document.getElementById('req-uppercase') },
        number: { regex: /[0-9]/, element: document.getElementById('req-number') },
        special: { regex: /[!@#$%^&*(),.?":{}|<>]/, element: document.getElementById('req-special') }
    };

    function validatePasswordStrength() {
        password = PasswordInput.value
        let strength = 0;
        let metRequirements = 0;
        for (const [key, req] of Object.entries(requirements)) {
            if (req.regex.test(password)) {
                req.element.classList.add('met');
                metRequirements++;
            } else {
                req.element.classList.remove('met');
            }
        }
        // Cclculate strength
        if (metRequirements <= 2) {
            strength = 'weak';
            strengthText.textContent = 'Թույլ';
            PasswordInput.classList.add('error');

        } else if (metRequirements <= 3) {
            strength = 'medium';
            strengthText.textContent = 'Միջին';
            PasswordInput.classList.remove('error');

        } else {
            strength = 'strong';
            strengthText.textContent = 'Ուժեղ';
            PasswordInput.classList.remove('error');

        }
        // update strength bar
        strengthBar.className = 'password-strength-bar ' + strength;
        strengthText.className = 'strength-text ' + strength;

        submitBtn.disabled = !(metRequirements >= 3);
    }
    function validatePasswordsMatch() {
        const Password = PasswordInput.value;
        const confirmPassword = confirmPasswordInput.value;

        if (Password === confirmPassword) {
            confirmPasswordInput.classList.remove('error');
        } else {
            confirmPasswordInput.classList.add('error');
        }
        submitBtn.disabled = !(Password === confirmPassword);

    }
    PasswordInput.addEventListener('input', validatePasswordStrength);
    confirmPasswordInput.addEventListener('input', validatePasswordsMatch);

    function validateForm() {
        const email = emailInput.value;
        const firstName = firstNameInput.value;
        const lastName = lastNameInput.value;

        const password = PasswordInput.value;

        let isValid = true;

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // regexp for email checking
        if (!email || !emailRegex.test(email)) {
            emailInput.classList.add('error');
            isValid = false;
        } else {
            emailInput.classList.remove('error');
        }

        // check name not empty
        if (!firstName) {
            firstNameInput.classList.add('error');
            isValid = false;
        } else {
            firstNameInput.classList.remove('error');
        }
        if (!lastName) {
            lastNameInput.classList.add('error');
            isValid = false;
        } else {
            lastNameInput.classList.remove('error');
        }
        // check password not empty
        if (!password) {
            PasswordInput.classList.add('error');
            confirmPasswordInput.classList.add('error');
            isValid = false;
        } else {
            PasswordInput.classList.remove('error');
            confirmPasswordInput.classList.remove('error');
        }
        return isValid
    }


    document.getElementById('register-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        const password = PasswordInput.value;
        const email = emailInput.value;
        const firstName = firstNameInput.value;
        const lastName = lastNameInput.value;
        // Еnsure every fields are valid before proceeding
        if (validateForm()) { //validateForm()                   ---!!!--- "1"  for testing  ---!!!--- 
            try {
                await registerUser({ email, password, firstName, lastName });
                await login(email, password);
                window.location.href = "profile_info.html";

            } catch (error) {
                if (1 || error.response && error.response.status === 409) { //---!!!--- "1" for testing  ---!!!--- 
                    errorMessage.textContent = "Տվյալ Էլ. փոստն արդեն գրանցված է։";
                }
                errorMessage.style.display = 'block';
                emailInput.classList.add('error');
                console.error(error);

                window.location.href = "profile_info.html"; //  ---!!!- for testing purposes
            }
        }
    });
    //red borders if invalid
    emailInput.addEventListener('input', () => {
        if (emailInput.value) {
            emailInput.classList.remove('error');
        }
    });

    firstNameInput.addEventListener('input', () => {
        if (firstNameInput.value) {
            nameInput.classList.remove('error');
        }
    });
});