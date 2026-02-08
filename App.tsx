import React, { useRef, useState, useEffect } from 'react';
import Dropzone from './components/Dropzone';
import QuestionCard from './components/QuestionCard';
import StatsModal from './components/StatsModal';
import { FileData, ParsedQuestion, ProcessingStatus, UploadedFileRecord, AudioInfo } from './types';
import { analyzeExamData, analyzeRawText } from './services/geminiService';
import { generateCSV, generateJSON, parseCSV } from './utils/csvHelper';
import * as storage from './services/storageService';

const App: React.FC = () => {
  const [appMode, setAppMode] = React.useState<'USER' | 'ADMIN'>('USER');
  const [status, setStatus] = React.useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [uploadedFiles, setUploadedFiles] = React.useState<UploadedFileRecord[]>([]);
  const [isLoaded, setIsLoaded] = React.useState(false);
  const [defaultsCleared, setDefaultsCleared] = React.useState(false);
  const [selectedUserRecordId, setSelectedUserRecordId] = React.useState<string | null>(null);
  const [currentMode, setCurrentMode] = React.useState<'LEARNING' | 'EXAM' | 'RANDOM'>('LEARNING');
  const [examSubmitted, setExamSubmitted] = React.useState(false);
  const [showExamResultModal, setShowExamResultModal] = React.useState(false);
  const [selectedYearFilter, setSelectedYearFilter] = React.useState<string>('ALL');
  const [selectedSubjectFilter, setSelectedSubjectFilter] = React.useState<string>('ALL');
  const [recordToDelete, setRecordToDelete] = React.useState<string | null>(null);
  const [showStatsModal, setShowStatsModal] = React.useState(false);
  const defaultFileIdsRef = React.useRef<Set<string>>(new Set());

  // 모바일 TTS 잠금 해제 (한 번만 실행)
  useEffect(() => {
    const unlockTTS = () => {
      const silent = new SpeechSynthesisUtterance('');
      silent.volume = 0;
      window.speechSynthesis.speak(silent);
      document.removeEventListener('click', unlockTTS);
      document.removeEventListener('touchstart', unlockTTS);
    };
    document.addEventListener('click', unlockTTS);
    document.addEventListener('touchstart', unlockTTS);
    return () => {
      document.removeEventListener('click', unlockTTS);
      document.removeEventListener('touchstart', unlockTTS);
    };
  }, []);

  useEffect(() => {
    const initializeAppData = async () => {
      let isDefaultsCleared = storage.getDefaultsClearedFlag();
      setDefaultsCleared(isDefaultsCleared);
      let currentFiles = storage.loadUploadedFiles();
      if (currentFiles.length === 0 && isDefaultsCleared) {
        storage.removeDefaultsClearedFlag();
        isDefaultsCleared = false; 
      }
      if (!isDefaultsCleared) {
        try {
          const manifestRes = await fetch('/manifest.json');
          const fileList: { file: string; name: string }[] = await manifestRes.json();
          defaultFileIdsRef.current = new Set(fileList.map(item => item.file));
          const existingIds = new Set(currentFiles.map(f => f.id));
          const deletedDefaultIds = storage.getDeletedDefaultIds();
          const filesToLoad = fileList.filter(item => !existingIds.has(item.file) && !deletedDefaultIds.has(item.file));
          if (filesToLoad.length > 0) {
            const filePromises = filesToLoad.map(async (item) => {
              try {
                const res = await fetch(`/${item.file}`);
                const text = await res.text();
                const questions = parseCSV(text);
                return { id: item.file, name: item.name, questionCount: questions.length, data: questions };
              } catch (err) { return null; }
            });
            const newRecords = (await Promise.all(filePromises)).filter((r): r is UploadedFileRecord => r !== null);
            currentFiles = [...currentFiles, ...newRecords];
          }
        } catch (e) {}
      }
      setUploadedFiles(currentFiles);
      setIsLoaded(true);
    };
    initializeAppData();
  }, []);

  useEffect(() => {
    if (isLoaded) storage.saveUploadedFiles(uploadedFiles.filter(f => f.id !== 'RANDOM_EXAM_SESSION'));
  }, [uploadedFiles, isLoaded]);

  const [adminViewingRecordId, setAdminViewingRecordId] = React.useState<string | null>(null);
  const [inputMode, setInputMode] = React.useState<'FILE' | 'TEXT' | 'IMPORT'>('FILE');
  const [questionFiles, setQuestionFiles] = React.useState<FileData[]>([]);
  const [answerFiles, setAnswerFiles] = React.useState<FileData[]>([]);
  const [rawTextInput, setRawTextInput] = React.useState('');
  const [retryMode, setRetryMode] = React.useState(false);
  const [retryIds, setRetryIds] = React.useState<Set<number>>(new Set());
  const [showScoreModal, setShowScoreModal] = React.useState(false);
  const [hasDismissedScore, setHasDismissedScore] = React.useState(false);
  const [navPage, setNavPage] = React.useState(0);
  const NAV_PAGE_SIZE = 10;
  const [activeAudioInfo, setActiveAudioInfo] = React.useState<AudioInfo | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const getYearFromRecord = (record: UploadedFileRecord): string => {
    const nameMatch = record.name.match(/^(\d{4})/);
    if (nameMatch) return nameMatch[1];
    if (record.data.length > 0) {
       const qYear = record.data[0].examYear || '';
       const dataMatch = qYear.match(/(\d{4})/);
       if (dataMatch) return dataMatch[1];
    }
    return '기타';
  };
  
  const getSubjectFromRecord = (record: UploadedFileRecord): string => record.data[0]?.subject || '기타 과목';

  const { uniqueYears, uniqueSubjects, filteredFiles } = React.useMemo(() => {
    const yearsSet = new Set<string>();
    uploadedFiles.forEach(f => { yearsSet.add(getYearFromRecord(f)); });
    const sortedYears = Array.from(yearsSet).sort((a, b) => b.localeCompare(a));
    const subjectsSet = new Set<string>();
    uploadedFiles.forEach(f => { subjectsSet.add(getSubjectFromRecord(f)); });
    const sortedSubjects = Array.from(subjectsSet).sort((a,b) => a.localeCompare(b));
    let filtered = uploadedFiles.filter(f => f.id !== 'RANDOM_EXAM_SESSION');
    if (selectedYearFilter !== 'ALL') filtered = filtered.filter(f => getYearFromRecord(f) === selectedYearFilter);
    if (selectedSubjectFilter !== 'ALL') filtered = filtered.filter(f => getSubjectFromRecord(f) === selectedSubjectFilter);
    filtered.sort((a, b) => b.name.localeCompare(a.name));
    return { uniqueYears: sortedYears, uniqueSubjects: sortedSubjects, filteredFiles: filtered };
  }, [uploadedFiles, selectedYearFilter, selectedSubjectFilter]);

  const scrollToQuestion = (id: number) => {
    const element = document.getElementById(`question-${id}`);
    if (element) {
      const headerHeight = 64;
      const navBar = document.getElementById('question-nav-bar');
      const navBarHeight = navBar ? navBar.offsetHeight : 0;
      const offsetPosition = element.getBoundingClientRect().top + window.pageYOffset - (headerHeight + navBarHeight + 20);
      window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = error => reject(error);
    });
  };

  const processFiles = (files: File[]) => Promise.all(files.map(async (file) => ({
    file, previewUrl: URL.createObjectURL(file), base64: await fileToBase64(file), mimeType: file.type,
  })));

  const handleDataImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setStatus(ProcessingStatus.PROCESSING);
    try {
      const promises = Array.from(files).map((file: File) => new Promise<UploadedFileRecord>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const content = event.target?.result as string;
            const questions = file.name.endsWith('.json') ? JSON.parse(content) : parseCSV(content);
            resolve({ id: Math.random().toString(36).substr(2, 9), name: file.name.replace(/\.(csv|json)$/i, ''), questionCount: questions.length, data: questions });
          } catch (err) { reject(err); }
        };
        reader.readAsText(file);
      }));
      const results = await Promise.all(promises);
      setUploadedFiles(prev => [...prev, ...results]);
      setStatus(ProcessingStatus.IDLE);
    } catch (err) { setStatus(ProcessingStatus.ERROR); }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAnalyze = async () => {
    if (inputMode === 'FILE' && questionFiles.length === 0) return alert("문제지 파일을 업로드해주세요.");
    setStatus(ProcessingStatus.PROCESSING);
    try {
      const newData = inputMode === 'FILE' ? await analyzeExamData(questionFiles, answerFiles) : await analyzeRawText(rawTextInput);
      const groupedData = newData.reduce((acc, curr) => {
        const subject = curr.subject?.trim() || "기타 과목";
        if (!acc[subject]) acc[subject] = [];
        acc[subject].push(curr);
        return acc;
      }, {} as Record<string, ParsedQuestion[]>);
      const newRecords = Object.entries(groupedData).map(([subject, questions]) => ({
        id: Math.random().toString(36).substr(2, 9),
        name: inputMode === 'FILE' ? `${questionFiles[0].file.name.split('.')[0]} - ${subject}` : `AI 분석 - ${subject}`,
        questionCount: questions.length, data: questions
      }));
      setUploadedFiles(prev => [...prev, ...newRecords]);
      setStatus(ProcessingStatus.IDLE);
      setQuestionFiles([]); setAnswerFiles([]); setRawTextInput('');
    } catch (err) { setStatus(ProcessingStatus.ERROR); }
  };

  const handleRestoreDefaults = () => {
    if (confirm("기본 데이터를 다시 로드하시겠습니까?")) {
      storage.clearDeletedDefaultIds();
      storage.removeDefaultsClearedFlag();
      window.location.reload();
    }
  };

  const handleDownloadAllData = () => {
    if (uploadedFiles.length === 0) return alert("다운로드할 데이터가 없습니다.");
    uploadedFiles.forEach((record, i) => setTimeout(() => generateCSV(record.data), i * 300));
  };

  const confirmDeleteRecord = () => {
    if (!recordToDelete) return;
    if (defaultFileIdsRef.current.has(recordToDelete)) storage.addDeletedDefaultId(recordToDelete);
    setUploadedFiles(prev => prev.filter(f => f.id !== recordToDelete));
    if (adminViewingRecordId === recordToDelete) setAdminViewingRecordId(null);
    if (selectedUserRecordId === recordToDelete) setSelectedUserRecordId(null);
    setRecordToDelete(null);
  };

  const handleUpdateQuestion = React.useCallback((id: number, updated: ParsedQuestion) => {
    setUploadedFiles(prev => prev.map(f => f.data.some(q => q.id === id) ? { ...f, data: f.data.map(mq => mq.id === id ? updated : mq) } : f));
  }, []);

  const handleExamSubmit = () => { setExamSubmitted(true); setShowExamResultModal(true); };

  const activeRecordId = appMode === 'ADMIN' ? adminViewingRecordId : selectedUserRecordId;
  const isExamLikeMode = appMode === 'USER' && (currentMode === 'EXAM' || currentMode === 'RANDOM');
  const currentQuestions = React.useMemo(() => {
    if (!activeRecordId) return [];
    const base = uploadedFiles.find(f => f.id === activeRecordId)?.data || [];
    return retryMode && appMode === 'USER' ? base.filter(q => retryIds.has(q.id)) : base;
  }, [uploadedFiles, activeRecordId, retryMode, appMode, retryIds]);

  const navItems = React.useMemo(() => currentQuestions.slice(navPage * NAV_PAGE_SIZE, (navPage + 1) * NAV_PAGE_SIZE), [currentQuestions, navPage]);
  const totalCount = currentQuestions.length;
  const answeredCount = currentQuestions.filter(q => q.userAnswer !== undefined).length;
  const score = totalCount > 0 ? Math.round((currentQuestions.filter(q => q.userAnswer === q.correctAnswer).length / totalCount) * 100) : 0;
  const feedback = (s: number) => s >= 80 ? { m: "합격 하세요!", e: "🏆", c: "text-emerald-600" } : s >= 60 ? { m: "노력 하세요!", e: "💪", c: "text-indigo-600" } : s >= 40 ? { m: "열공 하세요!", e: "🔥", c: "text-orange-600" } : { m: "5번만 풀어보세요!", e: "📚", c: "text-red-600" };

  const startDojo = () => {
    const wrong = currentQuestions.filter(q => q.userAnswer !== undefined && q.userAnswer !== q.correctAnswer);
    if (wrong.length === 0) return alert("틀린 문제가 없습니다!");
    setRetryIds(new Set(wrong.map(q => q.id)));
    setUploadedFiles(prev => prev.map(record => record.id === selectedUserRecordId ? { ...record, data: record.data.map(q => wrong.some(wq => wq.id === q.id) ? { ...q, userAnswer: undefined } : q) } : record));
    setRetryMode(true); setShowScoreModal(false); setShowExamResultModal(false); setHasDismissedScore(false); setNavPage(0); setCurrentMode('LEARNING');
  };

  const handleRetryDojo = () => {
    const stillWrong = currentQuestions.filter(q => q.userAnswer !== undefined && q.userAnswer !== q.correctAnswer);
    if (stillWrong.length === 0) {
      alert("모든 오답을 정복했습니다!"); setRetryMode(false); setRetryIds(new Set()); setSelectedUserRecordId(null); return;
    }
    const newRetryIds = new Set(stillWrong.map(q => q.id));
    setRetryIds(newRetryIds);
    setUploadedFiles(prev => prev.map(record => record.id === selectedUserRecordId ? { ...record, data: record.data.map(q => newRetryIds.has(q.id) ? { ...q, userAnswer: undefined } : q) } : record));
    setNavPage(0);
  };

  const startRandomMode = () => {
    const allQuestions = uploadedFiles.filter(f => f.id !== 'RANDOM_EXAM_SESSION').flatMap(file => file.data);
    if (allQuestions.length === 0) return alert('문제가 없습니다.');
    const randomQuestions = allQuestions.sort(() => 0.5 - Math.random()).slice(0, 20);
    const randomExamRecord = { id: 'RANDOM_EXAM_SESSION', name: '랜덤 모의고사', questionCount: randomQuestions.length, data: randomQuestions.map((q, idx) => ({ ...q, userAnswer: undefined, questionNumber: String(idx + 1) })) };
    setUploadedFiles(prev => [...prev.filter(f => f.id !== 'RANDOM_EXAM_SESSION'), randomExamRecord]);
    setSelectedUserRecordId(randomExamRecord.id); setCurrentMode('RANDOM'); setExamSubmitted(false); setNavPage(0); setRetryMode(false);
  };

  // FIX: Added handleModeSelection to fix the reference error on line 302 and centralize mode switch logic.
  const handleModeSelection = (mode: 'LEARNING' | 'EXAM' | 'RANDOM') => {
    if (mode === 'RANDOM') {
      startRandomMode();
    } else {
      setCurrentMode(mode);
      if (mode === 'EXAM') {
        setExamSubmitted(false);
      }
    }
  };

  useEffect(() => {
    if (appMode === 'USER' && currentMode === 'LEARNING' && selectedUserRecordId && totalCount > 0 && answeredCount === totalCount && !showScoreModal && !hasDismissedScore) setShowScoreModal(true);
  }, [answeredCount, totalCount, showScoreModal, hasDismissedScore, appMode, selectedUserRecordId, currentMode]);

  return (
    <div className={`min-h-screen pb-20 transition-all ${retryMode ? 'bg-orange-50' : 'bg-slate-50'}`}>
      <input type="file" ref={fileInputRef} className="hidden" accept=".csv,.json" multiple onChange={handleDataImport} />

      <header className={`sticky top-0 z-[60] h-16 ${retryMode ? 'bg-orange-600 text-white shadow-xl' : 'bg-white/95 backdrop-blur-md text-slate-800 shadow-sm'}`}>
        <div className="max-w-5xl mx-auto px-4 h-full flex items-center justify-between">
            <div className="flex items-center gap-2 md:gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black ${retryMode ? 'bg-white text-orange-600' : 'bg-indigo-600 text-white'}`}>AI</div>
              <h1 className="text-xl font-black tracking-tighter hidden sm:block">ExamAI</h1>
              <div className="flex bg-slate-100 p-1 rounded-xl ml-1 md:ml-4">
                  <button onClick={() => { setAppMode('USER'); setSelectedUserRecordId(null); setAdminViewingRecordId(null); setNavPage(0); }} className={`px-2 md:px-4 py-1.5 rounded-lg text-xs font-black transition-all ${appMode === 'USER' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400'}`}>사용자</button>
                  <button onClick={() => { setAppMode('ADMIN'); setAdminViewingRecordId(null); setNavPage(0); }} className={`px-2 md:px-4 py-1.5 rounded-lg text-xs font-black transition-all ${appMode === 'ADMIN' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400'}`}>관리자</button>
              </div>
            </div>
            <div className="flex gap-1 md:gap-2 items-center">
              {appMode === 'USER' && <button onClick={() => setShowStatsModal(true)} className="px-2 md:px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-xl text-[10px] md:text-xs font-black">통계</button>}
              {activeRecordId && (
                <>
                  <button onClick={() => { setSelectedUserRecordId(null); setAdminViewingRecordId(null); setRetryMode(false); setExamSubmitted(false); setNavPage(0); setUploadedFiles(prev => prev.filter(f => f.id !== 'RANDOM_EXAM_SESSION')); }} className="px-2 md:px-3 py-1.5 bg-slate-100 text-slate-600 rounded-xl text-[10px] md:text-xs font-black">목록</button>
                  {appMode === 'USER' && !retryMode && (currentMode === 'LEARNING' || examSubmitted) && <button onClick={startDojo} className="px-2 md:px-3 py-1.5 bg-orange-500 text-white rounded-xl text-[10px] md:text-xs font-black shadow-md">도장깨기</button>}
                </>
              )}
            </div>
        </div>
      </header>

      {activeRecordId && (
         <div id="question-nav-bar" className="sticky top-16 bg-white/95 backdrop-blur-md p-2 md:p-4 border-b z-50">
          <div className="max-w-3xl mx-auto flex flex-col gap-y-4">
            <div className="flex items-center justify-center flex-wrap gap-2">
                {appMode === 'USER' && !retryMode && (
                  <div className="flex bg-slate-100 p-1 rounded-2xl">
                      <button onClick={() => handleModeSelection('LEARNING')} className={`px-3 md:px-4 py-2 rounded-xl text-[11px] md:text-xs font-black transition-all ${currentMode === 'LEARNING' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-white'}`}>학습 모드</button>
                      <button onClick={() => handleModeSelection('EXAM')} className={`px-3 md:px-4 py-2 rounded-xl text-[11px] md:text-xs font-black transition-all ${currentMode === 'EXAM' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-white'}`}>시험 모드</button>
                      <button onClick={() => handleModeSelection('RANDOM')} className={`px-3 md:px-4 py-2 rounded-xl text-[11px] md:text-xs font-black transition-all ${currentMode === 'RANDOM' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-white'}`}>랜덤 모드</button>
                  </div>
                )}
            </div>
            <div className="flex items-center justify-between gap-2">
               <button onClick={() => setNavPage(Math.max(0, navPage - 1))} disabled={navPage === 0} className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-xl bg-white border-2 border-slate-100 text-slate-400 disabled:opacity-30 shrink-0">
                 <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 19l-7-7 7-7"/></svg>
               </button>
               <div className="flex gap-1 md:gap-2 overflow-x-auto no-scrollbar py-1">
                 {navItems.map((q) => {
                   const isAnswered = q.userAnswer !== undefined;
                   const isCorrect = q.userAnswer === q.correctAnswer;
                   const showAnswers = appMode === 'ADMIN' || (currentMode === 'LEARNING' && isAnswered) || examSubmitted;
                   return (
                     <button key={q.id} onClick={() => scrollToQuestion(q.id)} className={`w-9 h-9 md:w-11 md:h-11 rounded-xl border-2 flex items-center justify-center font-black text-xs md:text-sm shrink-0 ${isAnswered ? (showAnswers ? (isCorrect ? 'bg-emerald-500 text-white border-emerald-600' : 'bg-red-500 text-white border-red-600') : 'bg-indigo-500 text-white border-indigo-600') : 'bg-white text-slate-400 border-slate-200'}`}>
                       {q.questionNumber}
                     </button>
                   );
                 })}
               </div>
               <button onClick={() => setNavPage(navPage + 1)} disabled={(navPage + 1) * NAV_PAGE_SIZE >= currentQuestions.length} className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-xl bg-white border-2 border-slate-100 text-slate-400 disabled:opacity-30 shrink-0">
                 <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7"/></svg>
               </button>
            </div>
          </div>
         </div>
      )}

      <main className="max-w-5xl mx-auto px-4 mt-4 md:mt-12">
        {status === ProcessingStatus.PROCESSING ? (
          <div className="flex flex-col items-center justify-center py-32 space-y-6">
            <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
            <p className="font-black text-slate-600 animate-pulse">처리 중...</p>
          </div>
        ) : (
          <>
            {appMode === 'USER' && !selectedUserRecordId && (
              <div className="animate-fade-in space-y-8">
                <section className="text-center py-8">
                    <h2 className="text-3xl font-black text-slate-900 mb-2">오늘의 기출문제 학습 📝</h2>
                    <p className="font-bold text-slate-400">학습할 시험지를 선택하거나 공유 받은 파일을 불러오세요.</p>
                </section>
                <div className="flex justify-center items-center gap-4 mb-8">
                  <button onClick={() => fileInputRef.current?.click()} className="px-6 py-3 bg-indigo-600 text-white rounded-full text-sm font-black shadow-lg">CSV/JSON 불러오기</button>
                  <button onClick={startRandomMode} className="px-6 py-3 bg-emerald-600 text-white rounded-full text-sm font-black shadow-lg">랜덤 모의고사</button>
                </div>
                {uploadedFiles.length > 0 && (
                  <div className="space-y-4 mb-8">
                    <div className="flex justify-center gap-2 overflow-x-auto pb-2 no-scrollbar px-2">
                        <button onClick={() => setSelectedYearFilter('ALL')} className={`px-5 py-2.5 rounded-full text-xs font-black border whitespace-nowrap ${selectedYearFilter === 'ALL' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500'}`}>전체 연도</button>
                        {uniqueYears.map(year => <button key={year} onClick={() => setSelectedYearFilter(year)} className={`px-5 py-2.5 rounded-full text-xs font-black border whitespace-nowrap ${selectedYearFilter === year ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500'}`}>{year}년</button>)}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {filteredFiles.map(f => (
                    <button key={f.id} onClick={() => {setSelectedUserRecordId(f.id); setCurrentMode('LEARNING'); setExamSubmitted(false);}} className="w-full bg-white p-8 rounded-[2.5rem] border-2 border-slate-50 shadow-lg text-left hover:border-indigo-600 transition-all flex justify-between items-center">
                      <div className="flex-grow mr-4">
                        <div className="flex items-center gap-2 mb-2">
                           <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-0.5 rounded">{getYearFromRecord(f)}년</span>
                           <span className="text-[10px] font-black text-emerald-500 bg-emerald-50 px-2 py-0.5 rounded">{getSubjectFromRecord(f)}</span>
                        </div>
                        <div className="text-xl font-black text-slate-800 truncate mb-1">{f.name}</div>
                        <span className="text-xs font-black text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded">{f.questionCount}문제</span>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={(e) => { e.stopPropagation(); setRecordToDelete(f.id); }} className="p-2 text-slate-300 hover:text-red-500">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(appMode === 'ADMIN' && !adminViewingRecordId) && (
              <div className="space-y-8 animate-fade-in">
                 <section className="text-center py-8">
                    <h2 className="text-3xl font-black text-slate-900 mb-2">관리자 모드 🛠️</h2>
                    <p className="font-bold text-slate-400">문제를 분석하거나 기존 데이터를 관리하세요.</p>
                 </section>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white p-8 rounded-[2.5rem] border-2 border-slate-100 space-y-4">
                        <h3 className="text-lg font-black mb-4">데이터 가져오기</h3>
                        <button onClick={() => setInputMode('FILE')} className={`w-full py-4 rounded-2xl font-black transition-all ${inputMode === 'FILE' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}>파일 분석 (AI)</button>
                        <button onClick={() => setInputMode('TEXT')} className={`w-full py-4 rounded-2xl font-black transition-all ${inputMode === 'TEXT' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}>텍스트 분석 (AI)</button>
                        <button onClick={() => fileInputRef.current?.click()} className="w-full py-4 rounded-2xl font-black bg-emerald-600 text-white">JSON/CSV 직접 추가</button>
                    </div>
                    <div className="bg-white p-8 rounded-[2.5rem] border-2 border-slate-100 space-y-4">
                        <h3 className="text-lg font-black mb-4">데이터 관리</h3>
                        <button onClick={handleDownloadAllData} className="w-full py-4 rounded-2xl font-black bg-slate-800 text-white">전체 CSV 백업</button>
                        <button onClick={handleRestoreDefaults} className="w-full py-4 rounded-2xl font-black bg-indigo-50 text-indigo-600 border-2">기본 데이터 복구</button>
                    </div>
                 </div>
                 {inputMode === 'FILE' && (
                    <div className="bg-white p-8 rounded-[3rem] border-2 border-indigo-100 shadow-xl space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <Dropzone label="문제지" onFilesSelected={async (f) => setQuestionFiles(await processFiles(f))} />
                            <Dropzone label="정답지(선택)" onFilesSelected={async (f) => setAnswerFiles(await processFiles(f))} />
                        </div>
                        <button onClick={handleAnalyze} className="w-full py-6 bg-indigo-600 text-white rounded-[2rem] font-black">AI 분석 시작하기</button>
                    </div>
                 )}
                 {inputMode === 'TEXT' && (
                    <div className="bg-white p-8 rounded-[3rem] border-2 border-indigo-100 shadow-xl space-y-6">
                        <textarea className="w-full h-64 p-6 bg-slate-50 border-2 rounded-3xl" placeholder="문제 텍스트를 입력하세요..." value={rawTextInput} onChange={(e) => setRawTextInput(e.target.value)} />
                        <button onClick={handleAnalyze} className="w-full py-6 bg-indigo-600 text-white rounded-[2rem] font-black">AI 텍스트 분석 시작</button>
                    </div>
                 )}
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {filteredFiles.map(f => (
                        <div key={f.id} className="bg-white p-6 rounded-[2rem] border-2 border-slate-100 flex justify-between items-center group hover:border-indigo-600 transition-all">
                            <button onClick={() => setAdminViewingRecordId(f.id)} className="text-left flex-grow truncate mr-4">
                                <div className="text-xs font-black text-slate-400 mb-1">{getYearFromRecord(f)} | {getSubjectFromRecord(f)}</div>
                                <div className="font-black text-slate-800 truncate group-hover:text-indigo-600">{f.name}</div>
                            </button>
                            <div className="flex gap-2">
                                <button onClick={(e) => { e.stopPropagation(); generateCSV(f.data); }} className="w-10 h-10 rounded-xl bg-slate-100 text-slate-500">C</button>
                                <button onClick={(e) => { e.stopPropagation(); setRecordToDelete(f.id); }} className="w-10 h-10 rounded-xl bg-red-50 text-red-500">✕</button>
                            </div>
                        </div>
                    ))}
                 </div>
              </div>
            )}

            {activeRecordId && (
              <div className="space-y-8 pb-24">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                   <h2 className="text-3xl font-black text-slate-900">{uploadedFiles.find(f => f.id === activeRecordId)?.name}</h2>
                   {isExamLikeMode && !examSubmitted && <button onClick={handleExamSubmit} className="px-8 py-4 bg-indigo-600 text-white rounded-2xl font-black shadow-lg">시험 제출하기</button>}
                   {retryMode && <button onClick={handleRetryDojo} className="px-8 py-4 bg-orange-600 text-white rounded-2xl font-black shadow-lg">다시 풀기</button>}
                </div>
                <div className="space-y-8">
                  {currentQuestions.map((q) => (
                    <QuestionCard key={q.id} question={q} onUpdate={handleUpdateQuestion} onDelete={(qid) => setUploadedFiles(prev => prev.map(f => ({ ...f, data: f.data.filter(dq => dq.id !== qid) })))} isAdmin={appMode === 'ADMIN'} activeAudioInfo={activeAudioInfo} setActiveAudioInfo={setActiveAudioInfo} isExamMode={isExamLikeMode && !examSubmitted} showAnswers={appMode === 'ADMIN' || (currentMode === 'LEARNING' && q.userAnswer !== undefined) || examSubmitted} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {showScoreModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4 animate-fade-in">
          <div className="bg-white rounded-[3rem] w-full max-w-lg p-12 text-center shadow-2xl space-y-8">
            <div className="text-8xl">{feedback(score).e}</div>
            <div>
              <h2 className={`text-4xl font-black mb-2 ${feedback(score).c}`}>{score}점</h2>
              <p className="text-xl font-black text-slate-800">{feedback(score).m}</p>
            </div>
            <div className="flex flex-col gap-3">
              <button onClick={startDojo} className="w-full py-5 bg-orange-500 text-white rounded-[2rem] font-black shadow-xl">틀린 문제 도장깨기</button>
              <button onClick={() => { setShowScoreModal(false); setHasDismissedScore(true); }} className="w-full py-5 bg-slate-100 text-slate-600 rounded-[2rem] font-black">결과 닫기</button>
            </div>
          </div>
        </div>
      )}

      {showExamResultModal && <StatsModal data={uploadedFiles} onClose={() => setShowExamResultModal(false)} examRecordId={activeRecordId || undefined} onStartDojo={startDojo} />}
      {showStatsModal && <StatsModal data={uploadedFiles} onClose={() => setShowStatsModal(false)} />}

      {recordToDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4 animate-fade-in">
          <div className="bg-white rounded-[2.5rem] w-full max-w-sm p-10 text-center shadow-2xl space-y-6">
            <div className="text-5xl">⚠️</div>
            <h3 className="text-xl font-black text-slate-800">시험지를 삭제하시겠습니까?</h3>
            <div className="flex gap-3">
               <button onClick={confirmDeleteRecord} className="flex-grow py-4 bg-red-500 text-white rounded-2xl font-black">삭제</button>
               <button onClick={() => setRecordToDelete(null)} className="flex-grow py-4 bg-slate-100 text-slate-500 rounded-2xl font-black">취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;