import { ParsedQuestion } from '../types';

export const generateCSV = (data: ParsedQuestion[]): void => {
  const headers = [
    '기출년도',
    '과목',
    '문제',
    '보기1',
    '보기2',
    '보기3',
    '보기4',
    '보기5', // 5지 선다 추가
    '정답',
    '해설',
    '이미지',
    '이미지정렬',
    '검증됨'
  ];

  const rows = data.map((q) => {
    const escape = (str: string | number | undefined | boolean) => {
      const val = str === undefined ? '' : String(str);
      return `"${val.replace(/"/g, '""')}"`;
    };
    
    const combinedQuestionText = `${q.questionNumber}. ${q.questionText}`;

    const choice1 = q.choices[1] ? `1. ${q.choices[1]}` : '';
    const choice2 = q.choices[2] ? `2. ${q.choices[2]}` : '';
    const choice3 = q.choices[3] ? `3. ${q.choices[3]}` : '';
    const choice4 = q.choices[4] ? `4. ${q.choices[4]}` : '';
    const choice5 = q.choices[5] ? `5. ${q.choices[5]}` : ''; // 5번 보기 처리

    return [
      escape(q.examYear || ''),
      escape(q.subject || '과목없음'),
      escape(combinedQuestionText),
      escape(choice1),
      escape(choice2),
      escape(choice3),
      escape(choice4),
      escape(choice5),
      escape(q.correctAnswer),
      escape(q.explanation),
      escape(q.questionImage || ''),
      escape(q.questionImageAlignment || 'center'),
      escape(q.isVerified ?? true),
    ].join(',');
  });

  const csvContent = [headers.join(','), ...rows].join('\n');
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  // 파일명 동적 생성 (과목명 또는 첫 번째 문제 정보 기반)
  const subjectName = data[0]?.subject || '기출문제';
  const fileName = `ExamAI_${subjectName}_${new Date().toISOString().slice(0, 10)}.csv`;
  
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const generateJSON = (data: ParsedQuestion[], fileNameProp: string): void => {
  const jsonContent = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonContent], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  const fileName = `ExamAI_Share_${fileNameProp}_${new Date().toISOString().slice(0, 10)}.json`;
  
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const parseCSV = (csvText: string): ParsedQuestion[] => {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  const cleanText = csvText.replace(/^\uFEFF/, '');

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentField += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && nextChar === '\n') i++;
        currentRow.push(currentField);
        if (currentRow.length > 1 || currentRow[0] !== '') {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }
  }
  
  if (currentRow.length > 0 || currentField !== '') {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  const stripNumberPrefix = (text: string, num: number) => {
    if (!text) return '';
    const regex = new RegExp(`^${num}[\\.\\s]+(.*)`);
    const match = text.match(regex);
    return match ? match[1].trim() : text.trim();
  };

  const headers = rows[0] || [];
  const has5thChoice = headers.some(h => h.includes('보기5'));

  const dataRows = rows.slice(1);
  return dataRows.filter(row => row.length > 5).map((row, index) => {
    
    const fullText = row[2] || ''; 
    const match = fullText.match(/^(\d+)[\.\s]+(.*)/);
    const qNum = match ? match[1] : String(index + 1);
    const qText = match ? match[2] : fullText;

    const uniqueId = Date.now() + index + Math.floor(Math.random() * 1000000);

    const c1 = stripNumberPrefix(row[3] || '', 1);
    const c2 = stripNumberPrefix(row[4] || '', 2);
    const c3 = stripNumberPrefix(row[5] || '', 3);
    const c4 = stripNumberPrefix(row[6] || '', 4);
    
    let c5 = '';
    let correctAns: number;
    let explanation: string;
    let image: string | undefined;
    let imageAlignment: 'left' | 'center' | 'right' = 'center';
    let isVerified = true;

    if (has5thChoice) { // New format with 13 columns
      c5 = stripNumberPrefix(row[7] || '', 5);
      correctAns = parseInt(row[8]) || 1;
      explanation = row[9] || '';
      image = row[10] || undefined;
      imageAlignment = (row[11] || 'center') as 'left' | 'center' | 'right';
      isVerified = row[12] !== 'false';
    } else { // Old format with 10 columns
      correctAns = parseInt(row[7]) || 1;
      explanation = row[8] || '';
      image = row[9] || undefined;
    }

    return {
      id: uniqueId,
      examYear: row[0] || '',
      subject: row[1] || '과목없음',
      questionNumber: qNum,
      questionText: qText,
      choices: {
        1: c1,
        2: c2,
        3: c3,
        4: c4,
        5: c5
      },
      correctAnswer: correctAns,
      explanation: explanation,
      questionImage: image,
      questionImageAlignment: imageAlignment,
      isVerified: isVerified,
    };
  });
};
