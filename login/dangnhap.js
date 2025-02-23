import { 
    auth, 
    handleEmailLogin, 
    handleSignup, 
    handleGoogleLogin, 
    handlePasswordReset, 
    showError, 
    checkEmailVerification, 
    handleResendVerification 
  } from './auth.js';
  import { database } from './firebase-config.js';
  import { ref, update, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.1.0/firebase-database.js";
  import { onAuthStateChanged, signOut, fetchSignInMethodsForEmail } from "https://www.gstatic.com/firebasejs/10.1.0/firebase-auth.js";
  
  // ====== XỬ LÝ GIAO DIỆN ======
  
  const themeToggle = document.getElementById('theme-toggle');
  const toggleTheme = () => {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      if (currentTheme === 'dark') {
          document.documentElement.removeAttribute('data-theme');
          themeToggle.innerHTML = '<i class="bx bx-moon"></i>';
          localStorage.setItem('theme', 'light');
      } else {
          document.documentElement.setAttribute('data-theme', 'dark');
          themeToggle.innerHTML = '<i class="bx bx-sun"></i>';
          localStorage.setItem('theme', 'dark');
      }
  };
  
  // Kiểm tra và áp dụng theme đã lưu
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      themeToggle.innerHTML = '<i class="bx bx-sun"></i>';
  } else {
      themeToggle.innerHTML = '<i class="bx bx-moon"></i>';
  }
  
  // Sự kiện click cho nút chuyển đổi
  themeToggle.addEventListener('click', toggleTheme);


  // Hàm chuyển trạng thái loading cho button
  const setLoadingState = (button, isLoading) => {
    if (isLoading) {
      button.classList.add('loading');
      button.disabled = true;
    } else {
      button.classList.remove('loading');
      button.disabled = false;
    }
  };
  
  // Hàm toggle hiển thị mật khẩu
  const togglePassword = (inputId) => {
    const input = document.getElementById(inputId);
    const icon = document.querySelector(`[data-input="${inputId}"]`);
    if (input && icon) {
      if (input.type === "password") {
        input.type = "text";
        icon.classList.replace("bxs-show", "bxs-hide");
      } else {
        input.type = "password";
        icon.classList.replace("bxs-hide", "bxs-show");
      }
    }
  };
  document.querySelectorAll('.toggle-password').forEach(icon => {
    icon.addEventListener('click', function() {
      const inputId = this.getAttribute('data-input');
      togglePassword(inputId);
      this.classList.toggle('bxs-show');
      this.classList.toggle('bxs-hide');
    });
  });
  
  // Hàm đếm ngược cho nút gửi lại xác minh
  let countdownInterval = null;
  const COUNTDOWN_DURATION = 30;
  const startCountdown = () => {
    const resendButton = document.getElementById('resend-verification');
    const countdownElement = document.getElementById('countdown');
    let remaining = COUNTDOWN_DURATION;
    resendButton.disabled = true;
    countdownElement.textContent = remaining;

    const updateCountdown = () => {
        remaining -= 0.016; // Giảm mỗi 16ms (~60fps)
        countdownElement.textContent = Math.ceil(remaining);
        if (remaining > 0) {
            requestAnimationFrame(updateCountdown);
        } else {
            resendButton.disabled = false;
            countdownElement.textContent = '';
        }
    };
    requestAnimationFrame(updateCountdown);
};
  // Cho phép auth.js gọi hàm startCountdown nếu cần
  window.startCountdown = startCountdown;
  
  // ====== XỬ LÝ SỰ KIỆN ======
  
  // Đăng nhập bằng email/mật khẩu
  document.getElementById('login-button').addEventListener('click', async () => {
    const button = document.getElementById('login-button');
    try {
      setLoadingState(button, true);
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;
      const user = await handleEmailLogin(email, password);
      await update(ref(database, `users/${user.uid}`), {
        lastActive: serverTimestamp()
      });
      window.location.href = 'map.html';
    } catch (error) {
      showError('login', error.message);
    } finally {
      setLoadingState(button, false);
    }
  });
  
  // Đăng nhập bằng Google
  document.getElementById('google-login').addEventListener('click', async () => {
    const button = document.getElementById('google-login');
    try {
      setLoadingState(button, true);
      const result = await handleGoogleLogin();
      await update(ref(database, `users/${result.user.uid}`), {
        lastLogin: serverTimestamp(),
        provider: 'google',
        displayName: result.user.displayName,
        photoURL: result.user.photoURL
      });
      window.location.href = 'map.html';
    } catch (error) {
      showError('login', error.message);
    } finally {
      setLoadingState(button, false);
    }
  });
  
  // Theo dõi trạng thái đăng nhập
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      await user.reload(); 
      if (user.emailVerified) {
        window.location.href = 'map.html';
      } else {
        document.getElementById('verification-screen').classList.remove('hidden');
        document.getElementById('verification-email-display').textContent = user.email;
        startCountdown();
        const verificationCheckInterval = setInterval(async () => {
          try {
            const updatedUser = await checkEmailVerification(user);
            if (updatedUser.emailVerified) {
              clearInterval(verificationCheckInterval);
              await update(ref(database, `users/${updatedUser.uid}`), {
                lastLogin: serverTimestamp(),
                emailVerified: true
              });
              window.location.href = 'map.html';
            }
          } catch (error) {
            console.error("Lỗi kiểm tra xác minh:", error);
            clearInterval(verificationCheckInterval);
          }
        }, 3000);
      }
    }
  });
  
  // Gửi lại email xác minh
  document.getElementById('resend-verification').addEventListener('click', async () => {
    const button = document.getElementById('resend-verification');
    try {
      setLoadingState(button, true);
      await handleResendVerification();
    } catch (error) {
      showError('verification', error.message);
    } finally {
      setLoadingState(button, false);
    }
  });
  
  // Đăng ký tài khoản mới
  document.getElementById('signup-button').addEventListener('click', async () => {
    const button = document.getElementById('signup-button');
    try {
      setLoadingState(button, true);
      const email = document.getElementById('signup-email').value;
      const password = document.getElementById('signup-password').value;
      const confirmPassword = document.getElementById('signup-password-confirm').value;
      if (!email.includes('@')) throw new Error('Email không hợp lệ');
      if (password.length < 8) throw new Error('Mật khẩu phải có ít nhất 8 ký tự');
      if (password !== confirmPassword) throw new Error('Mật khẩu không khớp');
      const signInMethods = await fetchSignInMethodsForEmail(auth, email);
      if (signInMethods.length > 0) {
        throw new Error('Email đã tồn tại, vui lòng đăng nhập.');
      }
      const userCredential = await handleSignup(email, password);
      document.getElementById('signup-form').classList.add('hidden');
      document.getElementById('verification-screen').classList.remove('hidden');
      document.getElementById('verification-email-display').textContent = email;
    } catch (error) {
      showError('signup', error.message);
    } finally {
      setLoadingState(button, false);
    }
  });
  
  // Reset mật khẩu
  document.getElementById('reset-button').addEventListener('click', async () => {
    const button = document.getElementById('reset-button');
    try {
      setLoadingState(button, true);
      const email = document.getElementById('reset-email').value;
      await handlePasswordReset(email);
      showError('forgot', '✅ Yêu cầu đặt lại mật khẩu đã được gửi!', true);
    } catch (error) {
      showError('forgot', error.message);
    } finally {
      setLoadingState(button, false);
    }
  });
  
  // Đăng xuất sau khi xác minh
  document.getElementById('logout-after-verification').addEventListener('click', () => {
    signOut(auth).then(() => {
      window.location.href = 'login.html';
    });
  });
  
  // Chuyển đổi giữa các form
  document.getElementById('register-btn').addEventListener('click', () => {
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('signup-form').classList.remove('hidden');
    document.querySelector('.container').classList.add('active');
  });
  document.getElementById('login-btn').addEventListener('click', () => {
    document.getElementById('signup-form').classList.add('hidden');
    document.getElementById('login-form').classList.remove('hidden');
    document.querySelector('.container').classList.remove('active');
  });
  document.getElementById('forgot-password').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('forgot-password-form').classList.remove('hidden');
  });
  document.getElementById('back-to-login').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('forgot-password-form').classList.add('hidden');
    document.getElementById('login-form').classList.remove('hidden');
  });
  
  // Xử lý sự kiện nhấn Enter cho các form
  const setupEnterEvents = () => {
    const handlers = new Map();
    const addEnterListener = (element, buttonId) => {
      if (!element) return;
      const oldHandler = handlers.get(element);
      if (oldHandler) {
        element.removeEventListener('keydown', oldHandler);
      }
      const newHandler = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          document.getElementById(buttonId)?.click();
        }
      };
      handlers.set(element, newHandler);
      element.addEventListener('keydown', newHandler);
    };
  
    addEnterListener(document.getElementById('login-email'), 'login-button');
    addEnterListener(document.getElementById('login-password'), 'login-button');
    addEnterListener(document.getElementById('signup-email'), 'signup-button');
    addEnterListener(document.getElementById('signup-password'), 'signup-button');
    addEnterListener(document.getElementById('signup-password-confirm'), 'signup-button');
    addEnterListener(document.getElementById('reset-email'), 'reset-button');
  };
  
  document.getElementById('register-btn').addEventListener('click', () => {
    setTimeout(setupEnterEvents, 50);
  });
  document.getElementById('login-btn').addEventListener('click', () => {
    setTimeout(setupEnterEvents, 50);
  });
  document.getElementById('forgot-password').addEventListener('click', () => {
    setTimeout(setupEnterEvents, 50);
  });
  document.getElementById('back-to-login').addEventListener('click', () => {
    setTimeout(setupEnterEvents, 50);
  });
  setupEnterEvents();
  
  // ====== KIỂM TRA ĐIỀU KIỆN MẬT KHẨU (ĐĂNG KÝ) ======
  
  // Khi nhập mật khẩu, cập nhật trạng thái của các điều kiện
  const signupPasswordInput = document.getElementById('signup-password');
  if (signupPasswordInput) {
    signupPasswordInput.addEventListener('input', () => {
      const value = signupPasswordInput.value;
      const requirementLength = document.getElementById('requirement-length');
      const requirementUppercase = document.getElementById('requirement-uppercase');
      const requirementNumber = document.getElementById('requirement-number');
  
      // Kiểm tra độ dài
      if (value.length >= 8) {
        requirementLength.classList.add('valid');
      } else {
        requirementLength.classList.remove('valid');
      }
      // Kiểm tra chữ hoa
      if (/[A-Z]/.test(value)) {
        requirementUppercase.classList.add('valid');
      } else {
        requirementUppercase.classList.remove('valid');
      }
      // Kiểm tra chứa số
      if (/\d/.test(value)) {
        requirementNumber.classList.add('valid');
      } else {
        requirementNumber.classList.remove('valid');
      }
    });
  }
  