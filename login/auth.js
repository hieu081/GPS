import { auth, database } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut,
  fetchSignInMethodsForEmail,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.1.0/firebase-auth.js";
import { ref, set, update, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.1.0/firebase-database.js";

// Bản đồ thông báo lỗi
const errorMessages = {
  'auth/invalid-email': 'Email không hợp lệ',
  'auth/user-not-found': 'Tài khoản không tồn tại',
  'auth/invalid-login-credentials': 'Tài khoản hoặc mật khẩu không chính xác',
  'auth/wrong-password': 'Mật khẩu không chính xác',
  'auth/missing-password': 'Vui lòng nhập mật khẩu',    
  'auth/email-already-in-use': 'Email đã được đăng ký',
  'auth/weak-password': 'Mật khẩu phải có ít nhất 6 ký tự',
  'auth/too-many-requests': 'Sevrer quá tải, vui lòng thử lại sau',
  'auth/invalid-credential': 'Thông tin đăng nhập không hợp lệ',
  'auth/network-request-failed': 'Lỗi kết nối mạng',
  'auth/popup-closed-by-user': 'Đã hủy đăng nhập',
  'auth/missing-email': 'Vui lòng nhập email',
  'auth/requires-recent-login': 'Vui lòng đăng nhập lại để thực hiện thao tác này',
  'auth/user-disabled': 'Tài khoản đã bị vô hiệu hóa',
  'auth/operation-not-allowed': 'Phương thức đăng nhập không được kích hoạt',
  'auth/invalid-verification-code': 'Mã xác minh không hợp lệ',
  'auth/invalid-verification-id': 'ID xác minh không hợp lệ',
  'auth/missing-verification-code': 'Thiếu mã xác minh',
  'auth/expired-action-code': 'Mã hành động đã hết hạn'
};

// HÀM PHỤ TRỢ - TRẢ VỀ THÔNG BÁO LỖI TƯƠNG ỨNG
const getErrorMessage = (error) => {
  return errorMessages[error.code] || error.message || 'Lỗi hệ thống';
};

// KIỂM TRA ĐỊNH DẠNG EMAIL BẰNG REGEX
const validateEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
};

// HIỂN THỊ THÔNG BÁO LỖI/THÀNH CÔNG TRÊN GIAO DIỆN
export const showError = (formType, message, isSuccess = false) => {
  const errorElement = document.getElementById(`${formType}-error`);
  if (!errorElement) {
    console.error(`Element with ID ${formType}-error not found.`);
    return;
  }
  errorElement.textContent = message;
  errorElement.className = `error-message${isSuccess ? ' success' : ''}`;
  errorElement.style.display = 'block';
  setTimeout(() => {
    errorElement.style.display = 'none';
  }, 5000);
};

// KIỂM TRA EMAIL ĐÃ TỒN TẠI TRONG HỆ THỐNG
export const checkIfEmailExists = async (email) => {
  if (!validateEmail(email)) throw new Error('Định dạng email không hợp lệ');
  
  try {
    const methods = await fetchSignInMethodsForEmail(auth, email);
    return {
      exists: methods.length > 0,
      providers: methods
    };
  } catch (error) {
    console.error("Lỗi kiểm tra email:", error);
    throw new Error(getErrorMessage(error));
  }
};

// XỬ LÝ ĐĂNG NHẬP BẰNG EMAIL/MẬT KHẨU
export const handleEmailLogin = async (email, password) => {
  try {
    if (!validateEmail(email)) throw new Error('Định dạng email không hợp lệ');
    
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    if (!user.emailVerified) {
      await signOut(auth);
      throw new Error('Vui lòng xác minh email trước khi đăng nhập');
    }
    await update(ref(database, `users/${user.uid}`), {
      lastLogin: serverTimestamp(),
      provider: 'email',
      emailVerified: user.emailVerified
    });
    
    return user;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Lỗi đăng nhập:`, error);
    if (errorMessages) {
      showError('login', 'Sai tài khoản hoặc mật khẩu');
    } else {
      showError('login', getErrorMessage(error));
    }
    throw new Error(getErrorMessage(error));
  }
};

// KIỂM TRA TRẠNG THÁI XÁC MINH EMAIL
export const checkEmailVerification = async (user) => {
  try {
    await user.reload();
    if (user.emailVerified) {
      await update(ref(database, `users/${user.uid}`), {
        emailVerified: true
      });
    }
    return user;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Lỗi kiểm tra xác minh email:`, error);
    throw new Error(getErrorMessage(error));
  }
};

// XỬ LÝ ĐĂNG KÝ TÀI KHOẢN MỚI
export const handleSignup = async (email, password) => {
  try {
    if (!validateEmail(email)) throw new Error('Định dạng email không hợp lệ');
    if (password.length < 8) throw new Error('Mật khẩu phải có ít nhất 8 ký tự');
    if (!/[A-Z]/.test(password)) throw new Error('Mật khẩu phải chứa ít nhất 1 chữ hoa');
    if (!/\d/.test(password)) throw new Error('Mật khẩu phải chứa ít nhất 1 số');

    const emailCheck = await checkIfEmailExists(email);
    if (emailCheck.exists) {
      throw new Error('Email đã được đăng ký với phương thức: ' + emailCheck.providers.join(', '));
    }

    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    
    await set(ref(database, `users/${userCredential.user.uid}`), {
      email: userCredential.user.email,
      createdAt: serverTimestamp(),
      emailVerified: false
    });

    // Cấu hình actionCodeSettings cho link xác minh email
    const actionCodeSettings = {
        url: `https://your-deployed-site.com/login.html`,
        handleCodeInApp: false,
      };
      
    await sendEmailVerification(userCredential.user);
    return userCredential.user;

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Lỗi đăng ký:`, error);
    throw new Error(getErrorMessage(error));
  }
};

// GỬI LẠI EMAIL XÁC MINH
let lastSentTime = 0;
export const handleResendVerification = async () => {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('Người dùng không tồn tại');

    const now = Date.now();
    if (now - lastSentTime < 30000) {
      showError('verification', '❌ Vui lòng chờ 30 giây trước khi gửi lại.');
      return;
    }

    const actionCodeSettings = {
        url: `https://your-deployed-site.com/login.html`,
        handleCodeInApp: false,
    };
      
    await sendEmailVerification(user);
    lastSentTime = now;
    if (typeof startCountdown === 'function') {
      startCountdown();
    }

    showError('verification', '✅ Email xác minh đã được gửi lại!', true);
  } catch (error) {
    showError('verification', '❌ Lỗi: ' + getErrorMessage(error));
    console.error("Lỗi gửi lại email xác minh:", error);
  }
};

// ĐĂNG NHẬP BẰNG GOOGLE
export const handleGoogleLogin = async () => {
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({
      prompt: 'select_account'
    });
    
    await setPersistence(auth, browserLocalPersistence);
    const result = await signInWithPopup(auth, provider);
    
    await set(ref(database, `users/${result.user.uid}`), {
      email: result.user.email,
      displayName: result.user.displayName,
      lastLogin: serverTimestamp(),
      emailVerified: true
    });
    
    return true;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Lỗi đăng nhập Google:`, error);
    throw new Error(getErrorMessage(error));
  }
};

// XỬ LÝ RESET MẬT KHẨU
export const handlePasswordReset = async (email) => {
  try {
    if (!validateEmail(email)) throw new Error('Định dạng email không hợp lệ');
    await sendPasswordResetEmail(auth, email);
    return true;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Lỗi reset mật khẩu:`, error);
    throw new Error(getErrorMessage(error));
  }
};

export { auth };
