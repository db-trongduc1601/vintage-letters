import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { db, auth } from './firebase';
import { collection, addDoc, query, where, onSnapshot, serverTimestamp, doc, getDoc, setDoc, updateDoc, getDocs } from 'firebase/firestore';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "firebase/auth";
import { PenTool, Inbox, Send, Trash2, RotateCcw, Edit3, X, LogOut, Mail, BookOpen } from 'lucide-react';
import './App.css';

const TimeCapsuleCountdown = ({ targetMs }) => {
  const [timeLeft, setTimeLeft] = useState(targetMs - Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      const remaining = targetMs - Date.now();
      if (remaining <= 0) {
        clearInterval(timer);
        setTimeLeft(0);
      } else {
        setTimeLeft(remaining);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [targetMs]);

  if (timeLeft <= 0) return null;

  const d = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
  const h = Math.floor((timeLeft / (1000 * 60 * 60)) % 24);
  const m = Math.floor((timeLeft / 1000 / 60) % 60);
  const s = Math.floor((timeLeft / 1000) % 60);

  return (
    <div style={{ position: 'absolute', top: -30, left: '50%', transform: 'translateX(-50%)', background: 'rgba(22, 12, 8, 0.8)', padding: '4px 10px', borderRadius: 4, color: '#d4af37', fontFamily: "'Special Elite', monospace", fontSize: 14, whiteSpace: 'nowrap', zIndex: 3 }}>
      ⏳ {d > 0 && `${d}n `}{h.toString().padStart(2, '0')}:{m.toString().padStart(2, '0')}:{s.toString().padStart(2, '0')}
    </div>
  );
};

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const [needsDisplayName, setNeedsDisplayName] = useState(false);
  const [inputDisplayName, setInputDisplayName] = useState('');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // UI State
  const [activeTab, setActiveTab] = useState('compose'); // compose, inbox, sent, trash
  const [letters, setLetters] = useState([]);
  const [readingLetter, setReadingLetter] = useState(null);
  const [isReadingFlapOpen, setIsReadingFlapOpen] = useState(false);
  const [waxSealState, setWaxSealState] = useState('intact'); // 'intact', 'broken'
  const [sealDragStart, setSealDragStart] = useState(null);
  const [isLetterExpanded, setIsLetterExpanded] = useState(false);

  // Compose State
  const [composeStep, setComposeStep] = useState(1); // 1: Write, 1.5: Folding, 2: Split, 2.5: Flying, 3: Success
  const [isMailboxClosed, setIsMailboxClosed] = useState(false);
  const [receiverEmail, setReceiverEmail] = useState('');
  const [letterContent, setLetterContent] = useState('');
  const [stampImage, setStampImage] = useState(null);
  const [scheduledTime, setScheduledTime] = useState(''); // yyyy-mm-ddThh:mm
  const [isSending, setIsSending] = useState(false);

  // Crop Modal States
  const [cropImageSrc, setCropImageSrc] = useState(null);
  const [isCropModalOpen, setIsCropModalOpen] = useState(false);
  const [cropZoom, setCropZoom] = useState(1.0);
  const [cropPan, setCropPan] = useState({ x: 0, y: 0 });
  const [cropShape, setCropShape] = useState('perforated');
  const [imageRatio, setImageRatio] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Signature Pad State
  const sigCanvasRef = useRef(null);
  const [signatureData, setSignatureData] = useState(null);
  const [isDrawingSig, setIsDrawingSig] = useState(false);

  // Draft States
  const [saveStatus, setSaveStatus] = useState(''); // '', 'saving', 'saved'
  const [hasDraftToRestore, setHasDraftToRestore] = useState(false);

  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const mailboxRef = useRef(null);
  const envelopeRef = useRef(null);
  const composeContainerRef = useRef(null);
  const [flyTarget, setFlyTarget] = useState(null);

  const [userData, setUserData] = useState(null);
  const [collectedStamps, setCollectedStamps] = useState([]);

  useEffect(() => {
    let unsubUser = null;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        unsubUser = onSnapshot(doc(db, 'users', user.uid), (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            setUserData(data);
            if (data.displayName) {
              setDisplayName(data.displayName);
              setNeedsDisplayName(false);
            } else {
              setNeedsDisplayName(true);
            }
          } else {
            setUserData(null);
            setNeedsDisplayName(true);
          }
        });
        setCurrentUser(user);
      } else {
        if (unsubUser) unsubUser();
        setCurrentUser(null);
        setDisplayName('');
        setNeedsDisplayName(false);
        setLetters([]);
        setUserData(null);
      }
    });
    return () => {
      unsubscribe();
      if (unsubUser) unsubUser();
    };
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'users', currentUser.uid, 'collectedStamps'));
    const unsub = onSnapshot(q, (snap) => {
      setCollectedStamps(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [currentUser]);

  // Fetch Letters
  useEffect(() => {
    if (!currentUser) return;
    const lettersRef = collection(db, 'letters');
    const qReceived = query(lettersRef, where('receiverEmail', '==', currentUser.email));
    const qSent = query(lettersRef, where('senderEmail', '==', currentUser.email));

    let receivedDocs = [];
    let sentDocs = [];

    const updateMerged = () => {
      const map = new Map();
      [...receivedDocs, ...sentDocs].forEach(d => map.set(d.id, d));
      const merged = Array.from(map.values()).sort((a, b) => {
        const tA = a.timestamp ? a.timestamp.toMillis() : Date.now();
        const tB = b.timestamp ? b.timestamp.toMillis() : Date.now();
        return tB - tA;
      });
      setLetters(merged);
    };

    const unsubReceived = onSnapshot(qReceived, (snap) => {
      receivedDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateMerged();
    });

    const unsubSent = onSnapshot(qSent, (snap) => {
      sentDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateMerged();
    });

    return () => { unsubReceived(); unsubSent(); };
  }, [currentUser]);

  // Draft Auto-Save & Restore Effects
  useEffect(() => {
    if (activeTab === 'compose' && composeStep === 1) {
      const draft = localStorage.getItem('vintage_letter_draft_content');
      // Only set to true if current input fields are empty to avoid overriding active writing
      if (draft && draft.trim() && !letterContent.trim() && !receiverEmail.trim() && !stampImage) {
        setHasDraftToRestore(true);
      } else {
        setHasDraftToRestore(false);
      }
    } else {
      setHasDraftToRestore(false);
    }
  }, [activeTab, composeStep]);

  useEffect(() => {
    // Only auto-save during writing (step 1) or envelope labeling (step 2)
    if (composeStep !== 1 && composeStep !== 2) return;
    
    // If all fields are completely empty, we can clean up localStorage
    if (!letterContent.trim() && !receiverEmail.trim() && !stampImage) {
      localStorage.removeItem('vintage_letter_draft_content');
      localStorage.removeItem('vintage_letter_draft_receiver');
      localStorage.removeItem('vintage_letter_draft_stamp');
      return;
    }

    setSaveStatus('saving');
    const timer = setTimeout(() => {
      localStorage.setItem('vintage_letter_draft_content', letterContent);
      localStorage.setItem('vintage_letter_draft_receiver', receiverEmail);
      if (stampImage) {
        localStorage.setItem('vintage_letter_draft_stamp', stampImage);
      } else {
        localStorage.removeItem('vintage_letter_draft_stamp');
      }
      setSaveStatus('saved');
      // Hide status after 2 seconds
      setTimeout(() => setSaveStatus(''), 2000);
    }, 1500); // 1.5s debounce

    return () => clearTimeout(timer);
  }, [letterContent, receiverEmail, stampImage, composeStep]);

  const handleRestoreDraft = () => {
    const draftContent = localStorage.getItem('vintage_letter_draft_content') || '';
    const draftReceiver = localStorage.getItem('vintage_letter_draft_receiver') || '';
    const draftStamp = localStorage.getItem('vintage_letter_draft_stamp') || null;
    
    setLetterContent(draftContent);
    setReceiverEmail(draftReceiver);
    setStampImage(draftStamp);
    setHasDraftToRestore(false);
  };

  const handleDiscardDraft = () => {
    localStorage.removeItem('vintage_letter_draft_content');
    localStorage.removeItem('vintage_letter_draft_receiver');
    localStorage.removeItem('vintage_letter_draft_stamp');
    setHasDraftToRestore(false);
    setTick(t => t + 1); // Trigger re-render to update Draft tab
  };

  // Auth Handlers
  const handleRegister = async () => {
    if (!email || !password) return alert("Vui lòng nhập Email và Mật khẩu");
    try { await createUserWithEmailAndPassword(auth, email, password); } catch (e) { alert("Lỗi đăng ký: " + e.message); }
  };
  const handleLogin = async () => {
    if (!email || !password) return alert("Vui lòng nhập Email và Mật khẩu");
    try { await signInWithEmailAndPassword(auth, email, password); } catch (e) { alert("Lỗi đăng nhập: " + e.message); }
  };
  const handleGoogleLogin = async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (e) { alert("Lỗi đăng nhập Google: " + e.message); }
  };
  const saveDisplayName = async () => {
    if (!inputDisplayName.trim()) return alert("Vui lòng nhập tên hiển thị!");
    try {
      await setDoc(doc(db, 'users', currentUser.uid), { email: currentUser.email, displayName: inputDisplayName.trim(), createdAt: serverTimestamp() }, { merge: true });
      setDisplayName(inputDisplayName.trim());
      setNeedsDisplayName(false);
    } catch (e) { alert("Lỗi lưu tên: " + e.message); }
  };

  // Compose Handlers & Crop Modal Logic
  const getClampedPan = (x, y, zoomVal) => {
    const CROP_W = 150;
    const CROP_H = 180;
    const boxAspect = CROP_W / CROP_H;
    
    let baseWidth = CROP_W;
    let baseHeight = CROP_H;
    
    if (imageRatio > boxAspect) {
      baseHeight = CROP_H;
      baseWidth = CROP_H * imageRatio;
    } else {
      baseWidth = CROP_W;
      baseHeight = CROP_W / imageRatio;
    }
    
    const renderedWidth = baseWidth * zoomVal;
    const renderedHeight = baseHeight * zoomVal;
    
    const defaultX = (CROP_W - renderedWidth) / 2;
    const defaultY = (CROP_H - renderedHeight) / 2;
    
    const minX = CROP_W - defaultX - renderedWidth;
    const maxX = -defaultX;
    
    const minY = CROP_H - defaultY - renderedHeight;
    const maxY = -defaultY;
    
    return {
      x: Math.min(Math.max(x, minX), maxX),
      y: Math.min(Math.max(y, minY), maxY)
    };
  };

  const handleMouseDown = (e) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - cropPan.x, y: e.clientY - cropPan.y });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    const newX = e.clientX - dragStart.x;
    const newY = e.clientY - dragStart.y;
    setCropPan(getClampedPan(newX, newY, cropZoom));
  };

  const handleTouchStart = (e) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      setDragStart({ x: e.touches[0].clientX - cropPan.x, y: e.touches[0].clientY - cropPan.y });
    }
  };

  const handleTouchMove = (e) => {
    if (!isDragging || e.touches.length !== 1) return;
    const newX = e.touches[0].clientX - dragStart.x;
    const newY = e.touches[0].clientY - dragStart.y;
    setCropPan(getClampedPan(newX, newY, cropZoom));
  };

  const handleZoomChange = (e) => {
    const val = parseFloat(e.target.value);
    setCropZoom(val);
    setCropPan(prev => getClampedPan(prev.x, prev.y, val));
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const img = new Image();
        img.onload = () => {
          setImageRatio(img.width / img.height);
          setCropImageSrc(reader.result);
          setCropZoom(1.0);
          setCropPan({ x: 0, y: 0 });
          setIsCropModalOpen(true);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCropConfirm = () => {
    if (!cropImageSrc) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const STAMP_W = 200;
      const STAMP_H = 240;
      canvas.width = STAMP_W;
      canvas.height = STAMP_H;
      const ctx = canvas.getContext('2d');

      const imgAspect = img.width / img.height;
      const stampAspect = STAMP_W / STAMP_H;
      
      let baseWidth = STAMP_W;
      let baseHeight = STAMP_H;
      
      if (imgAspect > stampAspect) {
        baseHeight = STAMP_H;
        baseWidth = STAMP_H * imgAspect;
      } else {
        baseWidth = STAMP_W;
        baseHeight = STAMP_W / imgAspect;
      }

      const renderedWidth = baseWidth * cropZoom;
      const renderedHeight = baseHeight * cropZoom;

      const defaultX = (STAMP_W - renderedWidth) / 2;
      const defaultY = (STAMP_H - renderedHeight) / 2;

      // Translate the pan coordinate from UI scale (150 width) to Canvas scale (200 width)
      const canvasPanX = cropPan.x * (STAMP_W / 150);
      const canvasPanY = cropPan.y * (STAMP_H / 180);

      const left = defaultX + canvasPanX;
      const top = defaultY + canvasPanY;

      // Draw the cropped image first
      ctx.drawImage(img, left, top, renderedWidth, renderedHeight);

      // Mask and border application
      if (cropShape === 'circle') {
        ctx.globalCompositeOperation = 'destination-in';
        ctx.beginPath();
        ctx.arc(STAMP_W / 2, STAMP_H / 2, 95, 0, 2 * Math.PI);
        ctx.fill();

        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(93, 64, 55, 0.4)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(STAMP_W / 2, STAMP_H / 2, 95, 0, 2 * Math.PI);
        ctx.stroke();
      } 
      else if (cropShape === 'oval') {
        ctx.globalCompositeOperation = 'destination-in';
        ctx.beginPath();
        ctx.ellipse(STAMP_W / 2, STAMP_H / 2, 90, 110, 0, 0, 2 * Math.PI);
        ctx.fill();

        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(93, 64, 55, 0.4)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(STAMP_W / 2, STAMP_H / 2, 90, 110, 0, 0, 2 * Math.PI);
        ctx.stroke();
      } 
      else if (cropShape === 'heart') {
        ctx.globalCompositeOperation = 'destination-in';
        ctx.beginPath();
        ctx.moveTo(100, 60);
        ctx.bezierCurveTo(100, 30, 35, 30, 35, 95);
        ctx.bezierCurveTo(35, 145, 100, 195, 100, 220);
        ctx.bezierCurveTo(100, 195, 165, 145, 165, 95);
        ctx.bezierCurveTo(165, 30, 100, 30, 100, 60);
        ctx.fill();

        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(93, 64, 55, 0.4)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(100, 60);
        ctx.bezierCurveTo(100, 30, 35, 30, 35, 95);
        ctx.bezierCurveTo(35, 145, 100, 195, 100, 220);
        ctx.bezierCurveTo(100, 195, 165, 145, 165, 95);
        ctx.bezierCurveTo(165, 30, 100, 30, 100, 60);
        ctx.stroke();
      } 
      else if (cropShape === 'perforated') {
        ctx.globalCompositeOperation = 'destination-out';
        const R = 6;
        const spacing = 20;

        // Top & bottom edges
        for (let x = spacing; x < STAMP_W; x += spacing) {
          ctx.beginPath(); ctx.arc(x, 0, R, 0, 2 * Math.PI); ctx.fill();
          ctx.beginPath(); ctx.arc(x, STAMP_H, R, 0, 2 * Math.PI); ctx.fill();
        }
        // Left & right edges
        for (let y = spacing; y < STAMP_H; y += spacing) {
          ctx.beginPath(); ctx.arc(0, y, R, 0, 2 * Math.PI); ctx.fill();
          ctx.beginPath(); ctx.arc(STAMP_W, y, R, 0, 2 * Math.PI); ctx.fill();
        }

        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(93, 64, 55, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(10, 10, STAMP_W - 20, STAMP_H - 20);
        ctx.setLineDash([]); // Reset
      } 
      else if (cropShape === 'square') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(93, 64, 55, 0.4)';
        ctx.lineWidth = 2;
        ctx.strokeRect(5, 5, STAMP_W - 10, STAMP_H - 10);
        ctx.lineWidth = 1;
        ctx.strokeRect(10, 10, STAMP_W - 20, STAMP_H - 20);
      }

      setStampImage(canvas.toDataURL('image/png'));
      setIsCropModalOpen(false);
      setCropImageSrc(null);
    };
    img.src = cropImageSrc;
  };

  const renderCropModal = () => {
    const CROP_W = 150;
    const CROP_H = 180;
    const boxAspect = CROP_W / CROP_H;
    
    let baseWidth = CROP_W;
    let baseHeight = CROP_H;
    
    if (imageRatio > boxAspect) {
      baseHeight = CROP_H;
      baseWidth = CROP_H * imageRatio;
    } else {
      baseWidth = CROP_W;
      baseHeight = CROP_W / imageRatio;
    }
    
    const renderedWidth = baseWidth * cropZoom;
    const renderedHeight = baseHeight * cropZoom;
    
    const defaultX = (CROP_W - renderedWidth) / 2;
    const defaultY = (CROP_H - renderedHeight) / 2;
    
    const left = defaultX + cropPan.x;
    const top = defaultY + cropPan.y;

    return (
      <div className="crop-modal-overlay">
        <motion.div 
          className="crop-modal-content"
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ duration: 0.3, type: "spring", stiffness: 120, damping: 14 }}
        >
          <div className="crop-modal-header">
            <h3>✦ Thiết Kế Tem Thư ✦</h3>
            <button className="crop-close-btn" onClick={() => { setIsCropModalOpen(false); setCropImageSrc(null); }}><X size={18} /></button>
          </div>
          
          <div className="crop-modal-body">
            {/* Left Column: Crop Window */}
            <div className="crop-preview-column">
              <div 
                className="crop-window-wrapper"
                style={{ width: CROP_W + 16, height: CROP_H + 16, padding: 8, background: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.3)', border: '1px solid #8d6e63' }}
              >
                <div 
                  className="crop-window"
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={() => setIsDragging(false)}
                  onMouseLeave={() => setIsDragging(false)}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={() => setIsDragging(false)}
                  style={{
                    width: CROP_W,
                    height: CROP_H,
                    position: 'relative',
                    overflow: 'hidden',
                    cursor: isDragging ? 'grabbing' : 'grab',
                    backgroundColor: '#120a07',
                    userSelect: 'none'
                  }}
                >
                  <img 
                    src={cropImageSrc} 
                    alt="Crop preview" 
                    style={{
                      position: 'absolute',
                      left: left,
                      top: top,
                      width: renderedWidth,
                      height: renderedHeight,
                      pointerEvents: 'none',
                      maxWidth: 'none',
                      maxHeight: 'none',
                      filter: 'sepia(0.15) contrast(1.05)'
                    }}
                  />
                  
                  {/* SVG Shape Mask Guides */}
                  {cropShape === 'circle' && (
                    <svg className="crop-svg-mask" viewBox="0 0 150 180" style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 3}}>
                      <defs>
                        <mask id="crop-mask-circle">
                          <rect width="150" height="180" fill="white" />
                          <circle cx="75" cy="90" r="71.25" fill="black" />
                        </mask>
                      </defs>
                      <rect width="150" height="180" fill="rgba(24, 15, 10, 0.65)" mask="url(#crop-mask-circle)" />
                      <circle cx="75" cy="90" r="71.25" fill="none" stroke="#8d6e63" strokeWidth="2" strokeDasharray="4,2" />
                    </svg>
                  )}
                  
                  {cropShape === 'oval' && (
                    <svg className="crop-svg-mask" viewBox="0 0 150 180" style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 3}}>
                      <defs>
                        <mask id="crop-mask-oval">
                          <rect width="150" height="180" fill="white" />
                          <ellipse cx="75" cy="90" rx="67.5" ry="82.5" fill="black" />
                        </mask>
                      </defs>
                      <rect width="150" height="180" fill="rgba(24, 15, 10, 0.65)" mask="url(#crop-mask-oval)" />
                      <ellipse cx="75" cy="90" rx="67.5" ry="82.5" fill="none" stroke="#8d6e63" strokeWidth="2" strokeDasharray="4,2" />
                    </svg>
                  )}
                  
                  {cropShape === 'heart' && (
                    <svg className="crop-svg-mask" viewBox="0 0 150 180" style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 3}}>
                      <defs>
                        <mask id="crop-mask-heart">
                          <rect width="150" height="180" fill="white" />
                          <path d="M75,45 C75,22.5 26.25,22.5 26.25,71.25 C26.25,108.75 75,146.25 75,165 C75,146.25 123.75,108.75 123.75,71.25 C123.75,22.5 75,22.5 75,45 Z" fill="black" />
                        </mask>
                      </defs>
                      <rect width="150" height="180" fill="rgba(24, 15, 10, 0.65)" mask="url(#crop-mask-heart)" />
                      <path d="M75,45 C75,22.5 26.25,22.5 26.25,71.25 C26.25,108.75 75,146.25 75,165 C75,146.25 123.75,108.75 123.75,71.25 C123.75,22.5 75,22.5 75,45 Z" fill="none" stroke="#8d6e63" strokeWidth="2" strokeDasharray="4,2" />
                    </svg>
                  )}
                  
                  {cropShape === 'perforated' && (
                    <svg className="crop-svg-mask" viewBox="0 0 150 180" style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 3}}>
                      <defs>
                        <mask id="crop-mask-perforated">
                          <rect width="150" height="180" fill="white" />
                          <rect x="7" y="7" width="136" height="166" fill="black" />
                        </mask>
                      </defs>
                      <rect width="150" height="180" fill="rgba(24, 15, 10, 0.65)" mask="url(#crop-mask-perforated)" />
                      <rect x="7" y="7" width="136" height="166" fill="none" stroke="#8d6e63" strokeWidth="1.5" strokeDasharray="3,3" />
                    </svg>
                  )}
                  
                  {cropShape === 'square' && (
                    <svg className="crop-svg-mask" viewBox="0 0 150 180" style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 3}}>
                      <defs>
                        <mask id="crop-mask-square">
                          <rect width="150" height="180" fill="white" />
                          <rect x="5" y="5" width="140" height="170" fill="black" />
                        </mask>
                      </defs>
                      <rect width="150" height="180" fill="rgba(24, 15, 10, 0.65)" mask="url(#crop-mask-square)" />
                      <rect x="5" y="5" width="140" height="170" fill="none" stroke="#8d6e63" strokeWidth="1.5" />
                      <rect x="9" y="9" width="132" height="162" fill="none" stroke="rgba(141, 110, 99, 0.5)" strokeWidth="1" />
                    </svg>
                  )}
                </div>
              </div>
              <span className="crop-tip">Kéo rê để di chuyển hình ảnh</span>
            </div>
            
            {/* Right Column: Controls */}
            <div className="crop-controls-column">
              <div className="control-group">
                <label>Thu Phóng Hình Ảnh:</label>
                <div className="zoom-slider-container">
                  <input 
                    type="range" 
                    min="1" 
                    max="3" 
                    step="0.01" 
                    value={cropZoom} 
                    onChange={handleZoomChange}
                    className="zoom-slider"
                  />
                  <span className="zoom-value">{Math.round(cropZoom * 100)}%</span>
                </div>
              </div>

              <div className="control-group">
                <label>Hình Dáng Tem Thư:</label>
                <div className="shape-options-grid">
                  <div className={`shape-option ${cropShape === 'perforated' ? 'active' : ''}`} onClick={() => setCropShape('perforated')}>
                    <div className="shape-preview">
                      <svg viewBox="0 0 32 38" width="32" height="38" style={{display:'block'}}>
                        <rect x="2" y="2" width="28" height="34" fill="#d7c4b3" stroke="#8d6e63" strokeWidth="1.5" strokeDasharray="3,2" />
                      </svg>
                    </div>
                    <span>Răng cưa</span>
                  </div>
                  <div className={`shape-option ${cropShape === 'circle' ? 'active' : ''}`} onClick={() => setCropShape('circle')}>
                    <div className="shape-preview">
                      <svg viewBox="0 0 32 38" width="32" height="38" style={{display:'block'}}>
                        <circle cx="16" cy="19" r="14" fill="#d7c4b3" stroke="#8d6e63" strokeWidth="1.5" />
                      </svg>
                    </div>
                    <span>Hình tròn</span>
                  </div>
                  <div className={`shape-option ${cropShape === 'oval' ? 'active' : ''}`} onClick={() => setCropShape('oval')}>
                    <div className="shape-preview">
                      <svg viewBox="0 0 32 38" width="32" height="38" style={{display:'block'}}>
                        <ellipse cx="16" cy="19" rx="14" ry="17" fill="#d7c4b3" stroke="#8d6e63" strokeWidth="1.5" />
                      </svg>
                    </div>
                    <span>Hình Oval</span>
                  </div>
                  <div className={`shape-option ${cropShape === 'heart' ? 'active' : ''}`} onClick={() => setCropShape('heart')}>
                    <div className="shape-preview">
                      <svg viewBox="0 0 32 38" width="32" height="38" style={{display:'block'}}>
                        <path d="M16,10 C16,4 4,4 4,14 C4,22 16,30 16,34 C16,30 28,22 28,14 C28,4 16,4 16,10 Z" fill="#d7c4b3" stroke="#8d6e63" strokeWidth="1.5" />
                      </svg>
                    </div>
                    <span>Trái tim</span>
                  </div>
                  <div className={`shape-option ${cropShape === 'square' ? 'active' : ''}`} onClick={() => setCropShape('square')}>
                    <div className="shape-preview">
                      <svg viewBox="0 0 32 38" width="32" height="38" style={{display:'block'}}>
                        <rect x="2" y="2" width="28" height="34" fill="#d7c4b3" stroke="#8d6e63" strokeWidth="1.5" />
                        <rect x="5" y="5" width="22" height="28" fill="none" stroke="rgba(141, 110, 99, 0.5)" strokeWidth="1" />
                      </svg>
                    </div>
                    <span>Hình vuông</span>
                  </div>
                </div>
              </div>
              
              <button className="crop-confirm-btn" onClick={handleCropConfirm}>
                Cắt ảnh & Dán tem
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    );
  };

  const handleTextareaChange = (e) => {
    setLetterContent(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = e.target.scrollHeight + 'px';
  };

  const handleFoldLetter = () => {
    if (!letterContent.trim()) return alert('Bạn chưa viết gì cả!');
    setComposeStep(1.5); // Start folding animation
    setTimeout(() => {
      setComposeStep(2); // Move to split view
    }, 1500);
  };

  const handleSend = async () => {
    if (!receiverEmail.trim()) return alert('Vui lòng nhập Email người nhận!');
    setIsSending(true);
    setIsMailboxClosed(false);

    try {
      const q = query(collection(db, 'users'), where('email', '==', receiverEmail.trim()));
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        const confirmSend = window.confirm('Không tìm thấy người nhận này. Họ sẽ nhận được thư khi đăng ký tài khoản. Chắc chắn gửi?');
        if (!confirmSend) { setIsSending(false); return; }
      }

      // Calculate fly target from mailbox position
      if (mailboxRef.current && envelopeRef.current) {
        const mailboxRect = mailboxRef.current.getBoundingClientRect();
        const envelopeRect = envelopeRef.current.getBoundingClientRect();
        setFlyTarget({
          x: mailboxRect.left + mailboxRect.width / 2 - envelopeRect.left - envelopeRect.width / 2,
          y: mailboxRect.top + 60 - envelopeRect.top - envelopeRect.height / 2,
        });
      }

      setComposeStep(2.5); // Animation: Flying to mailbox

      let scheduleMs = Date.now();
      if (scheduledTime) {
        const selectedDate = new Date(scheduledTime);
        if (selectedDate.getTime() > scheduleMs) scheduleMs = selectedDate.getTime();
      }

      await addDoc(collection(db, 'letters'), {
        senderEmail: currentUser.email,
        senderName: displayName,
        receiverEmail: receiverEmail.trim(),
        content: letterContent,
        stamp: stampImage,
        signature: signatureData,
        timestamp: serverTimestamp(),
        scheduledTimeMs: scheduleMs,
        senderStatus: 'active',
        receiverStatus: 'active',
        isRead: false
      });

      let unlockedBorders = userData?.unlockedBorders || [];
      const hour = new Date().getHours();
      let newlyUnlocked = [];
      if (hour >= 0 && hour < 4 && !unlockedBorders.includes('moon')) newlyUnlocked.push('moon');
      if (letterContent.length > 1000 && !unlockedBorders.includes('feather')) newlyUnlocked.push('feather');
      
      if (newlyUnlocked.length > 0) {
        await updateDoc(doc(db, 'users', currentUser.uid), { 
          unlockedBorders: [...unlockedBorders, ...newlyUnlocked] 
        });
        const borderNames = newlyUnlocked.map(k => k === 'moon' ? '"Trăng khuyết"' : '"Lông vũ cổ đại"').join(' và ');
        setTimeout(() => alert(`🎉 Chúc mừng! Bạn đã mở khoá khung tem độc quyền: ${borderNames}`), 2500);
      }

      setTimeout(() => {
        setIsMailboxClosed(true); // Close mailbox door
        setTimeout(() => {
          setComposeStep(3); // Success Screen
          // Clear draft from localStorage
          localStorage.removeItem('vintage_letter_draft_content');
          localStorage.removeItem('vintage_letter_draft_receiver');
          localStorage.removeItem('vintage_letter_draft_stamp');
          
          setTimeout(() => {
            setLetterContent('');
            setReceiverEmail('');
            setStampImage(null);
            setSignatureData(null);
            setScheduledTime('');
            setComposeStep(1);
            setIsSending(false);
            setActiveTab('sent');
            setIsMailboxClosed(false);
            setFlyTarget(null);
          }, 2500);
        }, 800); // Wait for door to close
      }, 1200); // Wait for letter to fly in

    } catch (e) {
      alert('Lỗi khi gửi: ' + e.message);
      setIsSending(false);
      setComposeStep(2);
    }
  };

  // Letter Actions
  const moveToTrash = async (letter) => {
    try {
      const isSender = letter.senderEmail === currentUser.email;
      const isReceiver = letter.receiverEmail === currentUser.email;
      let updates = {};
      if (isSender) updates.senderStatus = 'trashed';
      if (isReceiver) updates.receiverStatus = 'trashed';
      if (isSender && isReceiver) {
        if (activeTab === 'inbox') updates.receiverStatus = 'trashed';
        if (activeTab === 'sent') updates.senderStatus = 'trashed';
      }
      await updateDoc(doc(db, 'letters', letter.id), updates);
    } catch (e) { alert('Lỗi: ' + e.message); }
  };

  const restoreLetter = async (letter) => {
    try {
      const isSender = letter.senderEmail === currentUser.email && letter.senderStatus === 'trashed';
      const isReceiver = letter.receiverEmail === currentUser.email && letter.receiverStatus === 'trashed';
      let updates = {};
      if (isSender) updates.senderStatus = 'active';
      if (isReceiver) updates.receiverStatus = 'active';
      await updateDoc(doc(db, 'letters', letter.id), updates);
    } catch (e) { alert('Lỗi: ' + e.message); }
  };

  const permanentlyDeleteLetter = async (letter) => {
    if (!window.confirm("Bạn có chắc chắn muốn xóa vĩnh viễn bức thư này không? Thư sẽ bị xóa hoàn toàn khỏi thùng rác của bạn.")) return;
    try {
      const isSender = letter.senderEmail === currentUser.email;
      const isReceiver = letter.receiverEmail === currentUser.email;
      let updates = {};
      if (isSender) updates.senderStatus = 'deleted';
      if (isReceiver) updates.receiverStatus = 'deleted';
      await updateDoc(doc(db, 'letters', letter.id), updates);
    } catch (e) { alert('Lỗi: ' + e.message); }
  };

  const rewriteLetter = (letter) => {
    setLetterContent(letter.content);
    setReceiverEmail(letter.receiverEmail);
    setStampImage(letter.stamp);
    setComposeStep(1);
    setActiveTab('compose');
  };

  const openLetter = async (letter) => {
    setReadingLetter(letter);
    setIsReadingFlapOpen(false);
    setWaxSealState('intact');
    setSealDragStart(null);
    if (letter.receiverEmail === currentUser.email && !letter.isRead) {
      try { await updateDoc(doc(db, 'letters', letter.id), { isRead: true }); } catch (e) {}
    }
  };

  const playCrackSound = () => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    
    const bufferSize = ctx.sampleRate * 0.1;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = buffer;
    
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1500;
    filter.Q.value = 1;

    noiseSource.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    
    gain.gain.setValueAtTime(2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    
    noiseSource.start();
  };

  const handleSealTouchStart = (e) => {
    if (waxSealState === 'broken') return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    setSealDragStart(clientX);
  };

  const handleSealTouchMove = (e) => {
    if (waxSealState === 'broken' || sealDragStart === null) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const diff = Math.abs(clientX - sealDragStart);
    if (diff > 40) {
      setWaxSealState('broken');
      playCrackSound();
      setTimeout(() => {
        setIsReadingFlapOpen(true);
      }, 500);
      setSealDragStart(null);
    }
  };

  const handleSealTouchEnd = () => {
    setSealDragStart(null);
  };

  const saveStampToAlbum = async (stampUrl, senderName) => {
    try {
      await addDoc(collection(db, 'users', currentUser.uid, 'collectedStamps'), {
        url: stampUrl,
        senderName: senderName,
        collectedAt: serverTimestamp()
      });
      alert('Đã lưu tem vào Sổ tay sưu tập!');
    } catch (e) {
      alert('Lỗi khi lưu tem: ' + e.message);
    }
  };

  // Signature Pad Handlers
  const startDrawingSig = (e) => {
    setIsDrawingSig(true);
    drawSig(e, false);
  };
  
  const endDrawingSig = () => {
    setIsDrawingSig(false);
    if (sigCanvasRef.current) {
      setSignatureData(sigCanvasRef.current.toDataURL('image/png'));
    }
  };
  
  const drawSig = (e, isMoving = true) => {
    if (!isDrawingSig && isMoving) return;
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000080';
    
    if (!isMoving) {
      ctx.beginPath();
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const clearSignature = () => {
    const canvas = sigCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setSignatureData(null);
    }
  };

  // Derived State (Filtering)
  const now = Date.now();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isReadingFlapOpen) {
      const timer = setTimeout(() => setIsLetterExpanded(true), 2500);
      return () => clearTimeout(timer);
    } else {
      setIsLetterExpanded(false);
    }
  }, [isReadingFlapOpen]);

  const inboxLetters = letters.filter(l => l.receiverEmail === currentUser?.email && l.receiverStatus === 'active').sort((a, b) => b.timestamp - a.timestamp);
  const sentLetters = letters.filter(l => l.senderEmail === currentUser?.email && l.senderStatus === 'active').sort((a, b) => b.timestamp - a.timestamp);
  const trashLetters = letters.filter(l => (l.receiverEmail === currentUser?.email && l.receiverStatus === 'trashed') || (l.senderEmail === currentUser?.email && l.senderStatus === 'trashed')).sort((a, b) => b.timestamp - a.timestamp);
  
  const unreadCount = inboxLetters.filter(l => !l.isRead && (!l.scheduledTimeMs || l.scheduledTimeMs <= now)).length;

  // --- Render Login ---
  if (!currentUser) {
    return (
      <div className="container">
        <div className="login-paper">
          <div className="login-flourish">✦ ─── ✦</div>
          <h1 className="title">Letters Tem</h1>
          <p className="login-tagline">Thương như cách ngày còn những khoảng cách</p>
          <input className="input" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="input" placeholder="Mật khẩu" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="btn btn-login" style={{width: '100%'}} onClick={handleLogin}>Đăng nhập</button>
          <button className="btn btn-register" style={{width: '100%'}} onClick={handleRegister}>Đăng ký</button>
          <div className="login-divider">✦ Hoặc ✦</div>
          <button className="btn btn-google" style={{width: '100%'}} onClick={handleGoogleLogin}>
            Đăng nhập bằng Google
          </button>
          <div className="login-watermark" />
        </div>
        <div className="noise-overlay" />
      </div>
    );
  }

  if (needsDisplayName) {
    return (
      <div className="container">
        <div className="login-paper">
          <div className="login-flourish">✦ ─── ✦</div>
          <h1 className="title">Chào người mới!</h1>
          <p className="display-name-subtitle">Bạn muốn được gọi bằng tên gì trên những phong thư?</p>
          <input className="input" placeholder="Bút danh / Tên hiển thị" value={inputDisplayName} onChange={(e) => setInputDisplayName(e.target.value)} />
          <button className="btn btn-login" style={{width: '100%'}} onClick={saveDisplayName}>Lưu Tên</button>
          <div className="login-watermark" />
        </div>
        <div className="noise-overlay" />
      </div>
    );
  }

  // --- Render Functions ---
  const renderSmallEnvelope = (letter, tabType) => {
    const isNew = tabType === 'inbox' && !letter.isRead;
    const isLocked = tabType === 'inbox' && letter.scheduledTimeMs > now;

    if (letter.isDraft) {
      return (
        <div className="small-envelope draft" key={letter.id} onClick={() => { setActiveTab('compose'); setComposeStep(1); handleRestoreDraft(); }}>
          {letter.stamp && <div className="env-stamp"><img src={letter.stamp} alt="stamp" /></div>}
          <div className="env-name">{letter.receiverEmail ? `Nháp gửi: ${letter.receiverEmail}` : 'Bản nháp mới'}</div>
          <div className="env-date" style={{ color: '#d32f2f', fontWeight: 'bold' }}>Chưa gửi (Bản nháp)</div>
          {letter.content && <div className="env-preview">{letter.content.substring(0, 40)}{letter.content.length > 40 ? '...' : ''}</div>}
          <div className="env-actions" onClick={e => e.stopPropagation()}>
            <button className="env-action-btn" title="Chỉnh sửa" onClick={() => { setActiveTab('compose'); setComposeStep(1); handleRestoreDraft(); }}><Edit3 size={16} /></button>
            <button className="env-action-btn" title="Xóa nháp" onClick={() => { handleDiscardDraft(); }}><Trash2 size={16} color="red" /></button>
          </div>
        </div>
      );
    }

    const isTimeCapsule = !!letter.scheduledTimeMs;

    if (isTimeCapsule && tabType === 'inbox') {
      return (
        <div 
          key={letter.id} 
          className={`time-capsule-chest ${isLocked ? '' : 'unlocked'}`} 
          title={isLocked ? `Sẽ mở khoá vào lúc: ${new Date(letter.scheduledTimeMs).toLocaleString('vi-VN')}` : 'Rương đã sẵn sàng mở!'}
          style={{ cursor: isLocked ? 'not-allowed' : 'pointer' }}
          onClick={isLocked ? undefined : () => openLetter(letter)}
        >
          <div className="chest-body"></div>
          <div className={`chest-lid ${isLocked ? '' : 'unlocked'}`}></div>
          <div className={`chest-lock ${isLocked ? '' : 'unlocked'}`}><div className="chest-keyhole"></div></div>
          {isLocked ? (
             <TimeCapsuleCountdown targetMs={letter.scheduledTimeMs} />
          ) : (
             <div style={{ position: 'absolute', top: -15, left: '50%', transform: 'translateX(-50%)', background: 'rgba(76, 175, 80, 0.9)', padding: '4px 10px', borderRadius: 4, color: '#fff', fontFamily: "'Special Elite', monospace", fontSize: 12, whiteSpace: 'nowrap', zIndex: 3, boxShadow: '0 2px 5px rgba(0,0,0,0.3)' }}>
               ✓ Sẵn sàng mở
             </div>
          )}
          <div style={{ position: 'absolute', width: '100%', textAlign: 'center', bottom: -25, color: '#8d6e63', fontFamily: "'Special Elite', monospace", fontSize: 13 }}>
            Rương từ: {letter.senderName}
          </div>
        </div>
      );
    }

    let nameToShow = tabType === 'inbox' ? letter.senderName : (tabType === 'sent' ? letter.receiverEmail : (letter.senderEmail === currentUser.email ? `Gửi: ${letter.receiverEmail}` : `Từ: ${letter.senderName}`));
    const dateStr = letter.scheduledTimeMs ? new Date(letter.scheduledTimeMs).toLocaleString() : 'Vừa xong';

    return (
      <div className="small-envelope" key={letter.id} onClick={() => openLetter(letter)}>
        {letter.stamp && <div className="env-stamp"><img src={letter.stamp} alt="stamp" /></div>}
        <div className="env-name">{nameToShow}</div>
        <div className="env-date">{dateStr}</div>
        {letter.content && <div className="env-preview">{letter.content.substring(0, 40)}{letter.content.length > 40 ? '...' : ''}</div>}
        {isNew && <div className="unread-dot" />}
        <div className="env-actions" onClick={e => e.stopPropagation()}>
          {tabType === 'sent' && <button className="env-action-btn" title="Xóa" onClick={() => moveToTrash(letter)}><Trash2 size={16} /></button>}
          {tabType === 'inbox' && <button className="env-action-btn" title="Xóa" onClick={() => moveToTrash(letter)}><Trash2 size={16} /></button>}
          {tabType === 'trash' && (
            <>
              <button className="env-action-btn" title="Phục hồi" onClick={() => restoreLetter(letter)}><RotateCcw size={16} /></button>
              {letter.senderEmail === currentUser.email && <button className="env-action-btn" title="Viết lại" onClick={() => rewriteLetter(letter)}><Edit3 size={16} /></button>}
              <button className="env-action-btn" title="Xóa vĩnh viễn" onClick={() => permanentlyDeleteLetter(letter)}><X size={16} color="red" /></button>
            </>
          )}
        </div>
      </div>
    );
  };

  // Compose Animations Layout
  const renderComposeView = () => {
    const isWriting = composeStep === 1;
    const isFolding = composeStep === 1.5;
    const isSplit = composeStep === 2;
    const isFlying = composeStep === 2.5;
    const isSuccess = composeStep === 3;

    return (
      <div ref={composeContainerRef} style={{flex: 1, display: 'flex', flexDirection: 'column', width: '100%', position: 'relative', overflow: 'hidden'}}>
        <AnimatePresence>
          {hasDraftToRestore && (
            <motion.div 
              className="draft-restore-banner"
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <span>
                📝 Bạn có một bản nháp chưa gửi từ trước. Bạn có muốn khôi phục không?
              </span>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="draft-banner-btn restore" onClick={handleRestoreDraft}>Khôi phục</button>
                <button className="draft-banner-btn discard" onClick={handleDiscardDraft}>Bỏ qua</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {isSuccess ? (
          <motion.div initial={{opacity: 0, scale: 0.8}} animate={{opacity: 1, scale: 1}} className="success-message" style={{position: 'absolute', top: '50%', left: '50%', x: '-50%', y: '-50%', zIndex: 20}}>
            <h2>✉️ Gửi thành công!</h2>
            <p style={{fontSize: 18, fontFamily: "'Special Elite', monospace"}}>Cánh thư của bạn đã được bỏ vào hòm thư...</p>
          </motion.div>
        ) : (
          <div className={isSplit || isFlying ? "compose-step-split" : "compose-step-1"} style={{ position: 'relative', flex: 1, width: '100%' }}>
            
            {/* The Envelope */}
              <motion.div 
                layoutId="main-envelope"
                ref={envelopeRef}
                className="sender-env-wrapper"
                animate={
                  isSplit ? (isMobile ? { scale: 0.5, x: 0, y: -50, position: 'relative', zIndex: 20 } : { scale: 0.35, x: -100, y: -150, position: 'absolute', zIndex: 20 }) : 
                  isFlying ? (isMobile ? { x: 0, y: -200, scale: 0.1, rotate: 25, opacity: 0 } : { x: '40vw', y: -50, scale: 0.1, rotate: 25, opacity: 0 }) : 
                  { scale: 1, x: 0, y: 0, position: 'relative', zIndex: 10 }
                }
                transition={{ duration: isFlying ? 1.0 : 1, ease: isFlying ? [0.45, 0, 0.15, 1] : "easeInOut" }}
                style={{ transformOrigin: 'center center' }}
              >
              <div className="sender-env-back"></div>
              
              {/* Top Flap */}
              <motion.div 
                className="sender-env-flap"
                initial={{ rotateX: 180, zIndex: 0 }}
                animate={{ rotateX: (isFolding || isSplit || isFlying) ? 0 : 180, zIndex: (isFolding || isSplit || isFlying) ? 5 : 0 }}
                transition={{ 
                  rotateX: { duration: 0.8, delay: (isFolding || isSplit || isFlying) ? 0.8 : 0, ease: "easeInOut" },
                  zIndex: { duration: 0, delay: (isFolding || isSplit || isFlying) ? 0.8 : 0 }
                }}
                style={{ originY: 0 }}
              />

              {/* Paper inside envelope */}
              <motion.div 
                className="sender-paper"
                animate={isFolding || isSplit || isFlying ? { y: 250, scale: 0.8, opacity: 0 } : { y: -50, scale: 1, opacity: 1 }}
                transition={
                  (isFolding || isSplit || isFlying) 
                    ? { y: { duration: 0.8, ease: "easeInOut" }, scale: { duration: 0.8, ease: "easeInOut" }, opacity: { duration: 0.1, delay: 0.7 } } 
                    : { duration: 0.8, ease: "easeInOut" }
                }
                style={{ zIndex: 2 }}
              >
                <div className="letter-paper-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: 15 }}>
                  <div className="letter-date-header" style={{ margin: 0 }}>
                    {new Date().toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  </div>
                  <AnimatePresence>
                    {saveStatus && (
                      <motion.span 
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 0.5, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="letter-draft-status"
                      >
                        {saveStatus === 'saving' ? 'Đang lưu...' : 'Đã lưu nháp...'}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
                <textarea
                  ref={textareaRef}
                  className="letter-input letter-font"
                  placeholder="Bắt đầu viết những dòng thư tay..."
                  value={letterContent}
                  onChange={handleTextareaChange}
                  style={{ flex: 1, minHeight: '40vh', pointerEvents: isWriting ? 'auto' : 'none' }}
                />
                <div className="signature-section" style={{ marginTop: 20, borderTop: '1px dashed #d7ccc8', paddingTop: 15, position: 'relative' }}>
                  {isWriting ? (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                        <span style={{ fontFamily: "'Playfair Display', serif", color: '#8d6e63', fontStyle: 'italic' }}>Ký tên của bạn:</span>
                        <button onClick={clearSignature} style={{ background: 'none', border: 'none', color: '#d32f2f', cursor: 'pointer', fontSize: 12 }}>Xóa chữ ký</button>
                      </div>
                      <canvas 
                        ref={sigCanvasRef}
                        width={280}
                        height={80}
                        style={{ background: 'rgba(255,255,255,0.3)', border: '1px solid rgba(141, 110, 99, 0.2)', borderRadius: 4, cursor: 'crosshair', touchAction: 'none' }}
                        onMouseDown={startDrawingSig}
                        onMouseMove={drawSig}
                        onMouseUp={endDrawingSig}
                        onMouseLeave={endDrawingSig}
                        onTouchStart={startDrawingSig}
                        onTouchMove={drawSig}
                        onTouchEnd={endDrawingSig}
                      />
                    </>
                  ) : (
                    signatureData && (
                      <div style={{ textAlign: 'right', paddingRight: 20 }}>
                        <img src={signatureData} alt="Signature" style={{ height: 60, opacity: 0.8 }} />
                      </div>
                    )
                  )}
                </div>
              </motion.div>

              <div className="sender-env-front"></div>

              {/* Sender Details on closed envelope */}
              <AnimatePresence>
                {(isSplit || isFlying) && (
                  <motion.div 
                    initial={{opacity: 0, x: "-50%"}} animate={{opacity: 1, x: "-50%"}} exit={{opacity: 0, x: "-50%"}}
                    transition={{ delay: 1.5 }}
                    style={{
                      position: 'absolute', 
                      bottom: 70, 
                      left: '50%', 
                      zIndex: 10, 
                      width: '80%', 
                      textAlign: 'center', 
                      fontFamily: "'Playfair Display', serif", 
                      color: '#5d4037', 
                      fontSize: 24
                    }}
                  >
                    <h3>Tới: {receiverEmail || '...'}</h3>
                    {stampImage && (
                      <img 
                        src={stampImage} 
                        alt="stamp" 
                        style={{
                          width: 80, 
                          height: 100, 
                          position: 'absolute', 
                          top: -60, 
                          right: 0, 
                          border: '2px dashed #e0e0e0', 
                          background: '#fff', 
                          padding: 4, 
                          transform: 'rotate(5deg)',
                          boxShadow: '2px 2px 5px rgba(0,0,0,0.2)'
                        }} 
                      />
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Fold Button */}
            <AnimatePresence>
              {isWriting && (
                <motion.div initial={{opacity: 1}} exit={{opacity: 0}} style={{ position: 'absolute', bottom: 40, zIndex: 10 }}>
                  <button className="wax-seal-btn" onClick={handleFoldLetter} style={{ marginTop: 20 }}>
                    <div className="wax-seal-circle">
                      <div className="wax-seal-inner">
                        <span className="wax-seal-symbol">⚜</span>
                      </div>
                    </div>
                    <span className="wax-seal-text">Gập thư</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Form Area - Visible in Split state */}
            <AnimatePresence>
              {isSplit && (
                <motion.div className="compose-form-area" initial={{opacity: 0, x: 50, y: "-50%"}} animate={{opacity: 1, x: 0, y: "-50%"}} exit={{opacity: 0, x: 50, y: "-50%"}} style={{ position: 'absolute', right: 80, top: '50%' }}>
                  <div className="pack-envelope-box">
                    <h2>Ghi phong bì</h2>
                    <input className="input-header" placeholder="Gửi tới Email..." value={receiverEmail} onChange={(e) => setReceiverEmail(e.target.value)} style={{marginBottom: 20, textAlign: 'center'}} />
                    
                    <div className="stamp-area" style={{ position: 'relative', top: 0, left: 0, marginBottom: 20, alignSelf: 'center' }}>
                      {stampImage ? (
                        <div className="stamp-wrapper" onClick={() => fileInputRef.current?.click()} style={{cursor: 'pointer'}}>
                          <img src={stampImage} alt="Stamp" className="stamp-image" />
                        </div>
                      ) : (
                        <div className="stamp-placeholder" onClick={() => fileInputRef.current?.click()}>Dán tem</div>
                      )}
                      <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*" onChange={handleImageUpload} />
                    </div>

                    <div style={{width: '100%', marginBottom: 30, padding: 15, background: 'rgba(255,255,255,0.4)', borderRadius: 4, border: '1px solid #d7ccc8'}}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontFamily: "'Playfair Display', serif", color: '#5d4037', fontSize: 16, fontWeight: 'bold' }}>
                        <input 
                          type="checkbox" 
                          checked={scheduledTime !== ''} 
                          onChange={(e) => setScheduledTime(e.target.checked ? new Date(Date.now() + 86400000 - (new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16) : '')} 
                          style={{ accentColor: '#8d6e63', width: 18, height: 18 }}
                        />
                        Niêm phong vào Rương Thời Gian
                      </label>
                      {scheduledTime !== '' && (
                        <div style={{ marginTop: 15 }}>
                          <input 
                            type="datetime-local" 
                            className="letter-input" 
                            value={scheduledTime} 
                            onChange={e => setScheduledTime(e.target.value)} 
                            style={{ background: '#fff', border: '1px solid #c8b39a', borderRadius: 4, fontFamily: "'Special Elite', monospace", fontSize: 14, padding: 8, color: '#3e2723', width: '100%' }}
                          />
                          <div style={{ fontSize: 12, color: '#8d6e63', marginTop: 8, fontStyle: 'italic', lineHeight: 1.4 }}>
                            * Người nhận sẽ nhận được một chiếc rương khoá kín cùng bộ đếm ngược. Họ sẽ không thể mở thư trước thời điểm này.
                          </div>
                        </div>
                      )}
                    </div>

                    <div style={{display: 'flex', gap: 20}}>
                      <button className="btn" style={{padding: '10px 20px', background: 'transparent', border: '1px solid #8d6e63', color: '#8d6e63', borderRadius: 4, cursor: 'pointer', fontFamily: "'Playfair Display', serif", fontWeight: 'bold'}} onClick={() => setComposeStep(1)}>Mở thư ra</button>
                      <button className="wax-seal-btn" onClick={handleSend} disabled={isSending}>
                        <div className="wax-seal-circle gold">
                          <div className="wax-seal-inner">
                            <span className="wax-seal-symbol">📯</span>
                          </div>
                        </div>
                        <span className="wax-seal-text">Gửi đi</span>
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Mailbox - Rendered during split/flying for ref calculation, but only visible during flying */}
            <AnimatePresence>
              {(isSplit || isFlying) && (
                <motion.div 
                  initial={{ opacity: 0 }} 
                  animate={isFlying ? { opacity: 1 } : { opacity: 0 }} 
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5 }}
                  style={{ 
                    position: 'absolute', 
                    bottom: 20, 
                    right: 40, 
                    zIndex: 5,
                    pointerEvents: isFlying ? 'auto' : 'none'
                  }}
                >
                  <div className="mailbox-scene" ref={mailboxRef}>
                    <div className="mailbox-post"></div>
                    <motion.div 
                      className="mailbox-flag"
                      animate={{ rotateZ: isMailboxClosed ? 0 : 90 }}
                      transition={{ duration: 0.5, type: "spring", stiffness: 100 }}
                    />
                    <div className="mailbox-body">
                      <div className="mailbox-interior">
                        <motion.div 
                          className="mailbox-inner-mail"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: isMailboxClosed ? 1 : 0 }}
                          transition={{ delay: 0.3 }}
                        />
                      </div>
                    </div>
                    <motion.div 
                      className="mailbox-door"
                      initial={{ rotateX: -110 }}
                      animate={{ rotateX: isMailboxClosed ? 0 : -110 }}
                      transition={{ duration: 0.6, type: "spring", stiffness: 80, damping: 12 }}
                    >
                      <div className="mailbox-door-handle"></div>
                    </motion.div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

          </div>
        )}
      </div>
    );
  };

  return (
    <div className="post-office-layout">
      {/* SIDEBAR */}
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <Mail size={22} />
            <h2>Bưu Điện</h2>
          </div>
          <div className="user-stamp">{displayName}</div>
          <button className="sign-out-btn" onClick={() => signOut(auth)}>
            <LogOut size={14} /> Đăng xuất
          </button>
        </div>
        
        <div className="nav-menu">
          <div className={`nav-item ${activeTab === 'compose' ? 'active' : ''}`} onClick={() => {setActiveTab('compose'); setComposeStep(1);}}>
            <PenTool size={20} /> Viết thư
          </div>
          <div className={`nav-item ${activeTab === 'inbox' ? 'active' : ''}`} onClick={() => setActiveTab('inbox')}>
            <Inbox size={20} /> Hộp thư đến
            {unreadCount > 0 ? <span className="nav-badge new">{unreadCount}</span> : <span className="nav-badge">0</span>}
          </div>
          <div className={`nav-item ${activeTab === 'sent' ? 'active' : ''}`} onClick={() => setActiveTab('sent')}>
            <Send size={20} /> Thư đã viết
          </div>
          <div className={`nav-item ${activeTab === 'album' ? 'active' : ''}`} onClick={() => setActiveTab('album')}>
            <BookOpen size={20} /> Sổ sưu tập tem
          </div>
          <div className={`nav-item ${activeTab === 'trash' ? 'active' : ''}`} onClick={() => setActiveTab('trash')}>
            <Trash2 size={20} /> Thùng rác
          </div>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="main-content">
        {activeTab === 'compose' && renderComposeView()}
        {activeTab === 'inbox' && (
          <motion.div initial={{opacity: 0}} animate={{opacity: 1}}>
            <div className="view-header"><h1>Hộp thư đến</h1></div>
            <div className="letters-grid">
              {inboxLetters.length === 0 ? <p style={{color: '#d7ccc8', fontFamily: "'Special Elite', monospace", paddingLeft: 20}}>Chưa có bức thư nào...</p> : inboxLetters.map(l => renderSmallEnvelope(l, 'inbox'))}
            </div>
          </motion.div>
        )}
        {activeTab === 'sent' && (
          <motion.div initial={{opacity: 0}} animate={{opacity: 1}}>
            <div className="view-header"><h1>Thư đã viết</h1></div>
            <div className="letters-grid">
              {(() => {
                const draftContent = localStorage.getItem('vintage_letter_draft_content');
                const draftReceiver = localStorage.getItem('vintage_letter_draft_receiver');
                const draftStamp = localStorage.getItem('vintage_letter_draft_stamp');
                const hasDraft = draftContent || draftReceiver || draftStamp;
                
                const draftLetter = hasDraft ? {
                  id: 'draft-local',
                  isDraft: true,
                  content: draftContent || '',
                  receiverEmail: draftReceiver || '',
                  stamp: draftStamp || null,
                } : null;

                const displayLetters = draftLetter ? [draftLetter, ...sentLetters] : sentLetters;

                if (displayLetters.length === 0) {
                  return <p style={{color: '#d7ccc8', fontFamily: "'Special Elite', monospace", paddingLeft: 20}}>Chưa có bức thư nào...</p>;
                }
                return displayLetters.map(l => renderSmallEnvelope(l, 'sent'));
              })()}
            </div>
          </motion.div>
        )}
        {activeTab === 'trash' && (
          <motion.div initial={{opacity: 0}} animate={{opacity: 1}}>
            <div className="view-header"><h1>Thùng rác</h1></div>
            <div className="letters-grid">
              {trashLetters.length === 0 ? <p style={{color: '#d7ccc8', fontFamily: "'Special Elite', monospace", paddingLeft: 20}}>Thùng rác trống...</p> : trashLetters.map(l => renderSmallEnvelope(l, 'trash'))}
            </div>
          </motion.div>
        )}
        {activeTab === 'album' && (
          <motion.div initial={{opacity: 0}} animate={{opacity: 1}}>
            <div className="view-header"><h1>Sổ tay sưu tập tem</h1></div>
            <div className="stamp-album-container" style={{ padding: 20 }}>
              <div className="stamp-album-book" style={{ background: '#f5ebe0', borderRadius: 8, padding: 30, minHeight: '60vh', boxShadow: 'inset 0 0 40px rgba(141,110,99,0.2), 0 10px 30px rgba(0,0,0,0.5)', border: '1px solid #c8b39a' }}>
                <div style={{ textAlign: 'center', fontFamily: "'Playfair Display', serif", color: '#5d4037', borderBottom: '2px dashed #d7ccc8', paddingBottom: 20, marginBottom: 30 }}>
                  <h2 style={{ fontSize: 24, margin: 0 }}>Bộ sưu tập của tôi</h2>
                  <p style={{ fontSize: 14, fontStyle: 'italic', opacity: 0.8, margin: '10px 0 0 0' }}>Những con tem mang đậm dấu ấn thời gian</p>
                </div>
                {collectedStamps.length === 0 ? (
                  <p style={{ textAlign: 'center', color: '#8d6e63', fontStyle: 'italic', marginTop: 50 }}>Bạn chưa sưu tầm được con tem nào...</p>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 30 }}>
                    {collectedStamps.map(stamp => (
                      <div key={stamp.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                        <div style={{ padding: 5, background: '#fff', border: '1px solid #e0e0e0', boxShadow: '2px 2px 5px rgba(0,0,0,0.2)', transform: `rotate(${Math.random() * 6 - 3}deg)` }}>
                          <img src={stamp.url} alt="Stamp" style={{ width: 80, height: 90, objectFit: 'contain' }} />
                        </div>
                        <div style={{ fontSize: 12, color: '#8d6e63', fontFamily: "'Special Elite', monospace", textAlign: 'center' }}>
                          Từ: {stamp.senderName}<br/>
                          <span style={{ opacity: 0.6 }}>{new Date(stamp.collectedAt?.toMillis() || Date.now()).toLocaleDateString('vi-VN')}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* FULLSCREEN READER */}
      <AnimatePresence>
        {readingLetter && (
          <motion.div className="fullscreen-reader" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button className="close-btn" onClick={() => {setReadingLetter(null); setIsReadingFlapOpen(false); setIsLetterExpanded(false);}}>
              <X size={18} /> Gập thư lại
            </button>
            <div 
              className="receiver-env-wrapper" 
              style={{ marginTop: '20vh', cursor: isReadingFlapOpen ? 'default' : 'pointer' }}
            >
              <div className="receiver-env-back"></div>


              <div className="receiver-env-sides"></div>
              <div className="receiver-env-front"></div>
              <motion.div 
                className="receiver-env-flap"
                animate={isReadingFlapOpen ? { rotateX: 180, zIndex: 0 } : { rotateX: 0, zIndex: 5 }}
                transition={{ duration: 0.8 }}
              >
                {!isReadingFlapOpen && (
                  <div 
                    className="crackable-seal-container"
                    style={{ opacity: waxSealState === 'broken' ? 0 : 1, transitionDelay: waxSealState === 'broken' ? '0.4s' : '0s' }}
                    onMouseDown={handleSealTouchStart}
                    onMouseMove={handleSealTouchMove}
                    onMouseUp={handleSealTouchEnd}
                    onMouseLeave={handleSealTouchEnd}
                    onTouchStart={handleSealTouchStart}
                    onTouchMove={handleSealTouchMove}
                    onTouchEnd={handleSealTouchEnd}
                  >
                    <div className={`crack-half crack-half-left ${waxSealState === 'broken' ? 'cracked-left' : ''}`}></div>
                    <div className={`crack-half crack-half-right ${waxSealState === 'broken' ? 'cracked-right' : ''}`}></div>
                    {waxSealState !== 'broken' && (
                      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#d4af37', fontSize: 24, pointerEvents: 'none' }}>
                        ⚜
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
              {!isReadingFlapOpen && (
                <div style={{ position: 'absolute', top: '20%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10, color: '#fff', fontFamily: "'Playfair Display', serif", pointerEvents: 'none', textAlign: 'center' }}>
                  <div style={{ fontSize: 14, opacity: 0.8 }}>Vuốt ngang con dấu sáp để bẻ</div>
                </div>
              )}
            </div>

            {/* EXPANDED LETTER VIEW */}
            <AnimatePresence>
              {isLetterExpanded && (
                <motion.div 
                  className="expanded-letter-overlay"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                >
                  <div className="expanded-letter-paper">
                    <div className="expanded-letter-header">
                      <span className="sender-name">{readingLetter.senderName}</span>
                      <span className="sender-email">({readingLetter.senderEmail})</span>
                      <span className="letter-date">
                        {new Date(readingLetter.scheduledTimeMs || (readingLetter.timestamp?.toMillis() || Date.now())).toLocaleString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="expanded-letter-content">
                      {readingLetter.content}
                    </div>
                    {readingLetter.signature && (
                      <div className="expanded-letter-signature" style={{ marginTop: 40, textAlign: 'right', paddingRight: 40 }}>
                        <img src={readingLetter.signature} alt="Signature" style={{ height: 80, opacity: 0.8 }} />
                      </div>
                    )}
                    {readingLetter.stamp && (
                      <div className="expanded-letter-stamp-section" style={{ marginTop: 40, borderTop: '1px dashed #d7ccc8', paddingTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
                          <img src={readingLetter.stamp} alt="Stamp" style={{ width: 60, height: 70, objectFit: 'contain' }} />
                          <div>
                            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, color: '#5d4037' }}>Tem đính kèm</div>
                            <div style={{ fontSize: 13, color: '#8d6e63' }}>Từ: {readingLetter.senderName}</div>
                          </div>
                        </div>
                        <button 
                          className="stamp-album-save-btn" 
                          onClick={() => saveStampToAlbum(readingLetter.stamp, readingLetter.senderName)}
                          style={{ background: 'none', border: '1px solid #8d6e63', borderRadius: 4, padding: '8px 12px', color: '#5d4037', cursor: 'pointer', fontFamily: "'Special Elite', monospace", transition: 'all 0.2s' }}
                          onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#8d6e63'; e.currentTarget.style.color = '#fff'; }}
                          onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#5d4037'; }}
                        >
                          Lưu vào Sổ tay
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isCropModalOpen && renderCropModal()}
      </AnimatePresence>

      <div className="noise-overlay" style={{ pointerEvents: 'none' }} />
    </div>
  );
}
