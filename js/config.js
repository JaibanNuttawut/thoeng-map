/**
 * เทิงแมพ (Thoeng Map) - Configuration & Constants
 * แก้ไขรหัส Admin, Firebase Config, Google Sheet และหมวดหมู่ได้ที่ไฟล์นี้
 */
const THOENG_CENTER = [19.6850, 100.1940];
const DEFAULT_ZOOM = 13;
const STORAGE_KEY = 'thoeng_map_custom_places_v1';
const COORD_OVERRIDES_KEY = 'thoeng_map_coord_overrides_v1';
const ADMIN_SESSION_KEY = 'thoeng_map_is_admin_v1';
const ADMIN_PIN = '1234'; // เปลี่ยนรหัสผ่าน Admin ได้ที่นี่

// Firebase Configuration (Project: thoeng-map)
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyAT6jtEunefuDgxLCRaqHwfEzqTn3Zb4Jw",
    authDomain: "thoeng-map.firebaseapp.com",
    projectId: "thoeng-map",
    storageBucket: "thoeng-map.firebasestorage.app",
    messagingSenderId: "156584581340",
    appId: "1:156584581340:web:bd31a8aac80d13ce767c19",
    measurementId: "G-DD16B80P26"
};
const FIRESTORE_COLLECTION = 'places';
let db = null;

// ตั้งค่า Google Sheet สำหรับดึงและบันทึกข้อมูลสถานที่ (2 ทาง)
// ใส่ Web App URL จาก Google Apps Script ใน appsScriptUrl เพื่อให้ทั้งอ่าน + เพิ่มหมุด + ย้ายพิกัดลงชีตได้โดยตรง
const GOOGLE_SHEET_CONFIG = {
    appsScriptUrl: '',
    csvUrl: '',
    sheetId: '1InXBPZhHAxOTzJADn608cGhgzDOeJN67Z4bKXXvJIGE',
    sheetName: 'places'
};

const CATEGORIES = {
    food: {
        id: 'food',
        label: 'ร้านอาหาร',
        icon: 'fa-utensils',
        color: '#ea580c', // orange-600
        bgLight: 'bg-orange-50 text-orange-700 border-orange-200',
        gradient: 'from-orange-500 via-amber-500 to-orange-600'
    },
    cafe: {
        id: 'cafe',
        label: 'คาเฟ่',
        icon: 'fa-mug-hot',
        color: '#92400e', // amber-800
        bgLight: 'bg-amber-50 text-amber-800 border-amber-200',
        gradient: 'from-amber-700 via-amber-600 to-yellow-700'
    },
    attraction: {
        id: 'attraction',
        label: 'ที่เที่ยว',
        icon: 'fa-mountain-sun',
        color: '#059669', // emerald-600
        bgLight: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        gradient: 'from-emerald-600 via-teal-600 to-cyan-700'
    },
    shop: {
        id: 'shop',
        label: 'ร้านค้า/ตลาด',
        icon: 'fa-store',
        color: '#2563eb', // blue-600
        bgLight: 'bg-blue-50 text-blue-700 border-blue-200',
        gradient: 'from-blue-600 via-indigo-600 to-blue-700'
    },
    stay: {
        id: 'stay',
        label: 'ที่พัก',
        icon: 'fa-bed',
        color: '#7c3aed', // violet-600
        bgLight: 'bg-violet-50 text-violet-700 border-violet-200',
        gradient: 'from-violet-600 via-purple-600 to-indigo-700'
    },
    service: {
        id: 'service',
        label: 'บริการ/ฉุกเฉิน',
        icon: 'fa-building-shield',
        color: '#dc2626', // red-600
        bgLight: 'bg-rose-50 text-rose-700 border-rose-200',
        gradient: 'from-rose-600 via-red-600 to-rose-700'
    }
};

const AUDIENCE_LABELS = {
    both: { label: 'คนพื้นที่ & นักท่องเที่ยว', badgeClass: 'bg-teal-50 text-teal-700 border-teal-200', icon: 'fa-users' },
    tourist: { label: 'แนะนำสำหรับนักท่องเที่ยว', badgeClass: 'bg-sky-50 text-sky-700 border-sky-200', icon: 'fa-suitcase-rolling' },
    local: { label: 'ข้อมูลเด็ดคนในพื้นที่', badgeClass: 'bg-amber-50 text-amber-800 border-amber-200', icon: 'fa-house-user' }
};
