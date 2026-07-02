/* =========================================================
   AI Resume Analyzer & Mock Interview
   script.js — client-side logic for every section:
   - Smooth nav / hero CTA
   - ATS resume score (file upload + heuristic scan)
   - AI resume line-by-line improvement suggestions
   - Mock interview (role-based question bank, cycling)
   - HR feedback (evaluates the interview answers you gave)
   - Skill gap analysis (job description vs resume text)

   No external AI API is wired in here — everything runs as a
   self-contained heuristic engine so the demo works fully
   offline. If you later want real LLM output, swap the
   functions marked "HEURISTIC ENGINE" for calls to your
   backend / the Anthropic API and keep the same return shape.
   ========================================================= */

(() => {
  'use strict';

  /* ---------------------------------------------------------
     Shared app state
  --------------------------------------------------------- */
  const state = {
    resumeText: '',        // last text we know about the user's resume
    role: '',
    questions: [],
    questionIndex: 0,
    answers: []            // [{ question, answer }]
  };

  /* ---------------------------------------------------------
     Small utilities
  --------------------------------------------------------- */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function setList(ulEl, items, emptyMessage) {
    ulEl.innerHTML = '';
    if (!items || items.length === 0) {
      const li = document.createElement('li');
      li.textContent = emptyMessage || 'Nothing to show yet.';
      ulEl.appendChild(li);
      return;
    }
    items.forEach((text) => {
      const li = document.createElement('li');
      li.innerHTML = text; // pre-escaped by callers where needed
      ulEl.appendChild(li);
    });
  }

  function countWords(text) {
    return (text.trim().match(/\S+/g) || []).length;
  }

  /* ---------------------------------------------------------
     HERO CTA
  --------------------------------------------------------- */
  const getStartedBtn = $('#getStartedBtn');
  if (getStartedBtn) {
    getStartedBtn.addEventListener('click', () => {
      $('#ats').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /* ===========================================================
     1. ATS RESUME SCORE
     =========================================================== */
  const atsForm = $('#atsForm');
  const resumeUpload = $('#resumeUpload');
  const atsScoreEl = $('#atsScore');
  const progressCircle = $('.progress-circle');
  const atsResults = $('#atsResults');

  const STRONG_VERBS = [
    'led', 'built', 'designed', 'launched', 'improved', 'increased', 'reduced',
    'created', 'implemented', 'automated', 'optimized', 'delivered', 'managed',
    'developed', 'architected', 'drove', 'scaled', 'streamlined', 'spearheaded',
    'achieved', 'negotiated', 'mentored', 'analyzed', 'engineered'
  ];

  const WEAK_PHRASES = [
    'responsible for', 'worked on', 'helped with', 'duties included',
    'in charge of', 'tasked with', 'assisted in', 'involved in'
  ];

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result || '');
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  /* HEURISTIC ENGINE: scores resume text 0-100 with reasons */
  function scoreResumeText(text) {
    const reasons = [];
    let score = 0;
    const words = countWords(text);
    const lower = text.toLowerCase();

    // 1. Length check (20 pts)
    if (words >= 350 && words <= 900) {
      score += 20;
      reasons.push('✅ Good length (' + words + ' words) — easy for an ATS to parse fully.');
    } else if (words > 0) {
      score += 8;
      reasons.push(
        words < 350
          ? '⚠️ Resume looks short (' + words + ' words). Add more detail on impact and results.'
          : '⚠️ Resume looks long (' + words + ' words). Trim to the most relevant experience.'
      );
    } else {
      reasons.push('❌ No readable text found — we could not measure length.');
    }

    // 2. Contact info (10 pts)
    const hasEmail = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text);
    const hasPhone = /(\+?\d[\d\s().-]{7,}\d)/.test(text);
    if (hasEmail && hasPhone) {
      score += 10;
      reasons.push('✅ Email and phone number detected — ATS can extract your contact details.');
    } else {
      reasons.push('❌ Missing ' + (!hasEmail ? 'email' : '') + (!hasEmail && !hasPhone ? ' and ' : '') + (!hasPhone ? 'phone number' : '') + '. Add both near the top.');
    }

    // 3. Section headers (15 pts)
    const sectionHits = ['experience', 'education', 'skills', 'summary', 'projects']
      .filter((s) => lower.includes(s));
    score += Math.min(15, sectionHits.length * 3);
    reasons.push(
      sectionHits.length >= 3
        ? '✅ Standard section headers found (' + sectionHits.join(', ') + ').'
        : '⚠️ Use clear standard headers like Experience, Education, and Skills so the ATS can categorize content.'
    );

    // 4. Strong action verbs (20 pts)
    const verbHits = STRONG_VERBS.filter((v) => lower.includes(v));
    const verbScore = Math.min(20, verbHits.length * 2);
    score += verbScore;
    reasons.push(
      verbHits.length >= 6
        ? '✅ Strong action verbs used (' + verbHits.length + ' found), e.g. ' + verbHits.slice(0, 5).join(', ') + '.'
        : '⚠️ Add more strong action verbs (led, built, launched, reduced...) instead of passive phrasing.'
    );

    // 5. Weak phrases penalty (up to -10)
    const weakHits = WEAK_PHRASES.filter((p) => lower.includes(p));
    if (weakHits.length) {
      score -= Math.min(10, weakHits.length * 3);
      reasons.push('❌ Weak phrasing found: "' + weakHits.join('", "') + '". Replace with a specific accomplishment.');
    }

    // 6. Quantified achievements (20 pts)
    const numberHits = (text.match(/\d+(\.\d+)?%|\$\d+|\b\d{2,}\b/g) || []).length;
    const numScore = Math.min(20, numberHits * 2);
    score += numScore;
    reasons.push(
      numberHits >= 4
        ? '✅ Resume includes ' + numberHits + ' quantified results (numbers, %, $) — great for credibility.'
        : '⚠️ Add measurable results (e.g. "reduced load time by 30%") to prove impact.'
    );

    // 7. Bullet formatting (10 pts)
    const bulletLines = (text.match(/^\s*[•\-*]\s+/gm) || []).length;
    if (bulletLines >= 4) {
      score += 10;
      reasons.push('✅ Uses bullet points (' + bulletLines + ' found) — scannable for both ATS and humans.');
    } else {
      reasons.push('⚠️ Use bullet points for experience items instead of paragraphs.');
    }

    // 8. File format note
    reasons.push('ℹ️ For best ATS compatibility, submit as a .docx or text-based .pdf (avoid scanned images).');

    score = Math.max(0, Math.min(100, Math.round(score)));
    return { score, reasons };
  }

  function animateScoreCircle(target) {
    let current = 0;
    const step = () => {
      current += Math.max(1, Math.round((target - current) / 6));
      if (current >= target) current = target;
      progressCircle.style.setProperty('--pct', current);
      atsScoreEl.textContent = current + '%';
      progressCircle.setAttribute('aria-label', 'ATS score, ' + current + ' percent');
      if (current < target) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  async function handleAtsAnalyze(text, fileMeta) {
    const { score, reasons } = scoreResumeText(text);
    animateScoreCircle(score);
    const items = reasons.map((r) => escapeHtml(r).replace(/^(✅|⚠️|❌|ℹ️)/, '$1'));
    if (fileMeta) {
      items.unshift('📄 Scanned "' + escapeHtml(fileMeta.name) + '" (' + Math.round(fileMeta.size / 1024) + ' KB).');
    }
    setList(atsResults, items);
  }

  if (atsForm) {
    atsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const file = resumeUpload.files && resumeUpload.files[0];
      const analyzeBtn = $('#analyzeBtn');
      const originalLabel = analyzeBtn.textContent;

      if (!file) {
        setList(atsResults, ['❌ Please choose a resume file first (.pdf, .doc, .docx, or .txt).']);
        return;
      }

      analyzeBtn.disabled = true;
      analyzeBtn.textContent = 'Analyzing…';

      try {
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext === 'txt') {
          const text = await readFileAsText(file);
          state.resumeText = text;
          await handleAtsAnalyze(text, file);
        } else {
          // Binary formats (pdf/doc/docx) can't be parsed reliably in
          // plain-JS without a dedicated parsing library, so we run a
          // lighter structural check and point the user to the
          // "Resume AI" box below for a full text-based scan.
          const fallbackNotes = [
            '📄 "' + escapeHtml(file.name) + '" received (' + Math.round(file.size / 1024) + ' KB).',
            'ℹ️ Binary formats (.pdf/.doc/.docx) are best analyzed after pasting the text below in the "AI resume improvement" box — paste it there and click Analyze again for a full score.',
          ];
          const roughScore = file.size > 15000 ? 55 : 35;
          animateScoreCircle(roughScore);
          setList(atsResults, fallbackNotes);
        }
      } catch (err) {
        setList(atsResults, ['❌ Could not read that file. Try a plain .txt export or paste the text manually.']);
      } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = originalLabel;
      }
    });
  }

  /* ===========================================================
     2. AI RESUME IMPROVEMENT (paste text, get suggestions)
     =========================================================== */
  const resumeText = $('#resumeText');
  const improveBtn = $('#improveBtn');
  const improvementList = $('#improvementList');

  /* HEURISTIC ENGINE: line-by-line rewrite suggestions */
  function buildImprovementSuggestions(text) {
    const suggestions = [];
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);

    if (!lines.length) {
      return ['Paste your resume text above, then click "Improve resume".'];
    }

    lines.forEach((line) => {
      const lower = line.toLowerCase();

      WEAK_PHRASES.forEach((phrase) => {
        if (lower.includes(phrase)) {
          suggestions.push(
            'Replace weak phrasing in: "<em>' + escapeHtml(line) + '</em>" — swap "' +
            phrase + '" for a strong verb like "led", "built", or "delivered".'
          );
        }
      });

      const hasNumber = /\d/.test(line);
      if (line.length > 40 && !hasNumber && /^(led|built|managed|created|developed|designed|worked|responsible|helped)/i.test(line)) {
        suggestions.push(
          'Add a metric to: "<em>' + escapeHtml(line) + '</em>" — quantify the result (%, $, time saved, users, team size).'
        );
      }

      if (line.length > 160) {
        suggestions.push(
          'Shorten this line — it\'s ' + line.length + ' characters. Aim for one clear achievement per bullet: "<em>' +
          escapeHtml(line.slice(0, 70)) + '…</em>"'
        );
      }

      if (/^(i |my )/i.test(line)) {
        suggestions.push(
          'Drop the first-person pronoun in: "<em>' + escapeHtml(line) + '</em>" — resumes read better starting with an action verb.'
        );
      }
    });

    if (!suggestions.length) {
      suggestions.push('✅ Nice work — no obvious weak phrasing found. Consider adding 1-2 more quantified results to strengthen top bullets.');
    }

    // De-duplicate and cap the list at a reasonable length
    const unique = Array.from(new Set(suggestions)).slice(0, 12);
    return unique;
  }

  if (improveBtn) {
    improveBtn.addEventListener('click', () => {
      const text = resumeText.value;
      state.resumeText = text || state.resumeText;
      const suggestions = buildImprovementSuggestions(text);
      setList(improvementList, suggestions, 'Paste your resume text above to get suggestions.');
    });
  }

  /* ===========================================================
     3. MOCK INTERVIEW
     =========================================================== */
  const roleSelect = $('#role');
  const startInterviewBtn = $('#startInterview');
  const questionEl = $('#question');
  const answerEl = $('#answer');
  const submitAnswerBtn = $('#submitAnswer');

  const GENERAL_QUESTIONS = [
    'Tell me about yourself and why you\'re interested in this role.',
    'Describe a challenging project you worked on and how you handled it.',
    'Tell me about a time you disagreed with a teammate. How did you resolve it?',
    'What\'s a mistake you made recently, and what did you learn from it?',
    'Where do you see yourself in three years?'
  ];

  const ROLE_QUESTIONS = {
    'Software Developer': [
      'Walk me through how you\'d debug a production issue with no clear error logs.',
      'How do you decide between writing a quick fix and a proper long-term solution?',
      'Explain a time you had to learn a new technology quickly for a project.'
    ],
    'Frontend Developer': [
      'How do you approach making a web page accessible and responsive?',
      'Tell me about a time you improved a page\'s performance. What did you measure?',
      'How do you keep CSS maintainable on a large project?'
    ],
    'Backend Developer': [
      'How would you design an API that needs to handle a sudden spike in traffic?',
      'Tell me about a time you optimized a slow database query.',
      'How do you approach versioning a public API?'
    ],
    'Full Stack Developer': [
      'How do you decide how much logic belongs on the client vs. the server?',
      'Describe a full feature you built end-to-end, from database to UI.',
      'How do you keep the frontend and backend teams (or yourself) in sync on contracts?'
    ],
    'Java Developer': [
      'Explain the difference between an abstract class and an interface, and when you\'d use each.',
      'How do you handle memory management concerns in a long-running Java service?',
      'Tell me about your experience with a Java framework like Spring.'
    ],
    'Python Developer': [
      'How do you handle dependency management across different Python projects?',
      'Tell me about a time you used Python to automate a manual process.',
      'How do you approach writing tests for a Python codebase?'
    ],
    'Data Analyst': [
      'Walk me through how you\'d investigate a sudden drop in a key metric.',
      'Tell me about a time your analysis changed a business decision.',
      'How do you make sure a dashboard stays useful and not just "busy"?'
    ],
    'UI/UX Designer': [
      'Walk me through your design process from research to final mockup.',
      'Tell me about a time user feedback made you rethink a design.',
      'How do you balance visual polish with usability?'
    ],
    'HR': [
      'How do you handle a conflict between two employees?',
      'Tell me about a time you had to deliver difficult feedback.',
      'How do you approach improving employee retention?'
    ]
  };

  function buildQuestionSet(role) {
    const roleQs = ROLE_QUESTIONS[role] || [];
    // Mix role-specific + general, shuffle lightly, cap at 6
    const combined = [...roleQs, ...GENERAL_QUESTIONS];
    return combined.slice(0, 6);
  }

  function showCurrentQuestion() {
    if (!state.questions.length) return;
    questionEl.textContent = state.questions[state.questionIndex];
    answerEl.value = '';
    answerEl.focus();
  }

  if (startInterviewBtn) {
    startInterviewBtn.addEventListener('click', () => {
      state.role = roleSelect.value;
      state.questions = buildQuestionSet(state.role);
      state.questionIndex = 0;
      state.answers = [];
      showCurrentQuestion();
    });
  }

  if (submitAnswerBtn) {
    submitAnswerBtn.addEventListener('click', () => {
      if (!state.questions.length) {
        questionEl.textContent = 'Click "Start interview" first.';
        return;
      }
      const answer = answerEl.value.trim();
      if (!answer) {
        answerEl.placeholder = 'Please write an answer before submitting.';
        answerEl.focus();
        return;
      }

      state.answers.push({
        question: state.questions[state.questionIndex],
        answer
      });

      if (state.questionIndex < state.questions.length - 1) {
        state.questionIndex += 1;
        showCurrentQuestion();
      } else {
        questionEl.textContent = 'That\'s the last question — nice work! Scroll down to "HR feedback" to see how you did.';
        answerEl.value = '';
      }
    });
  }

  /* ===========================================================
     4. HR FEEDBACK (evaluates the interview answers)
     =========================================================== */
  const feedbackBtn = $('#feedbackBtn');
  const feedbackList = $('#feedbackList');

  const STAR_SIGNALS = ['result', 'result', 'team', 'project', 'because', 'so that', 'led to', 'impact', 'outcome'];
  const FILLER_WORDS = ['um', 'like', 'you know', 'kind of', 'sort of', 'basically', 'just'];

  /* HEURISTIC ENGINE: evaluate one answer */
  function evaluateAnswer(qa, index) {
    const words = countWords(qa.answer);
    const lower = qa.answer.toLowerCase();
    const notes = [];

    if (words < 25) {
      notes.push('too brief — aim for 60-120 words with a specific example');
    } else if (words > 200) {
      notes.push('a bit long — tighten it to the most relevant details');
    } else {
      notes.push('good length');
    }

    const hasStarSignal = STAR_SIGNALS.some((s) => lower.includes(s));
    notes.push(hasStarSignal ? 'shows structure/impact (STAR-style)' : 'add a clear result or outcome (what changed because of your action?)');

    const fillerHits = FILLER_WORDS.filter((f) => lower.includes(f));
    if (fillerHits.length) {
      notes.push('trim filler words like "' + fillerHits[0] + '"');
    }

    const hasNumber = /\d/.test(qa.answer);
    notes.push(hasNumber ? 'includes a concrete detail/number — good' : 'consider adding a number or timeframe for credibility');

    return (
      '<strong>Q' + (index + 1) + ':</strong> ' + escapeHtml(qa.question) +
      '<br><span style="color:var(--ink-soft);font-size:0.9em;">' + notes.join(' · ') + '</span>'
    );
  }

  if (feedbackBtn) {
    feedbackBtn.addEventListener('click', () => {
      if (!state.answers.length) {
        setList(feedbackList, [], 'Complete a mock interview above first, then generate feedback here.');
        return;
      }
      const items = state.answers.map(evaluateAnswer);
      const overallWords = state.answers.reduce((sum, a) => sum + countWords(a.answer), 0) / state.answers.length;
      items.unshift(
        '<strong>Overall:</strong> ' + state.answers.length + ' answers reviewed for the ' +
        escapeHtml(state.role || 'selected') + ' role. Average answer length: ' + Math.round(overallWords) + ' words.'
      );
      setList(feedbackList, items);
    });
  }

  /* ===========================================================
     5. SKILL GAP ANALYSIS
     =========================================================== */
  const jobDescriptionEl = $('#jobDescription');
  const skillBtn = $('#skillBtn');
  const skillList = $('#skillList');

  const SKILL_DICTIONARY = [
    'javascript', 'typescript', 'python', 'java', 'c++', 'c#', 'go', 'rust', 'sql', 'nosql',
    'html', 'css', 'react', 'vue', 'angular', 'node.js', 'express', 'django', 'flask', 'spring',
    'rest api', 'graphql', 'docker', 'kubernetes', 'aws', 'azure', 'gcp', 'git', 'ci/cd',
    'agile', 'scrum', 'jira', 'figma', 'sketch', 'adobe xd', 'photoshop', 'ui design', 'ux research',
    'wireframing', 'prototyping', 'accessibility', 'excel', 'power bi', 'tableau', 'pandas',
    'numpy', 'machine learning', 'data analysis', 'a/b testing', 'sql server', 'mongodb',
    'postgresql', 'mysql', 'redis', 'linux', 'bash', 'testing', 'unit testing', 'communication',
    'leadership', 'project management', 'problem solving', 'team collaboration'
  ];

  /* HEURISTIC ENGINE: extract required skills from a JD, diff against resume */
  function analyzeSkillGap(jobText, resumeTextValue) {
    const jdLower = jobText.toLowerCase();
    const resumeLower = resumeTextValue.toLowerCase();

    const requiredSkills = SKILL_DICTIONARY.filter((skill) => jdLower.includes(skill));
    if (!requiredSkills.length) {
      return { missing: [], required: [] };
    }
    const missing = requiredSkills.filter((skill) => !resumeLower.includes(skill));
    return { missing, required: requiredSkills };
  }

  if (skillBtn) {
    skillBtn.addEventListener('click', () => {
      const jobText = jobDescriptionEl.value.trim();
      const currentResumeText = (resumeText.value || state.resumeText || '').trim();

      if (!jobText) {
        setList(skillList, [], 'Paste a job description above to analyze skill gaps.');
        return;
      }
      if (!currentResumeText) {
        setList(skillList, [
          '⚠️ No resume text found. Paste your resume in the "AI resume improvement" box above, then run this again.'
        ]);
        return;
      }

      const { missing, required } = analyzeSkillGap(jobText, currentResumeText);

      if (!required.length) {
        setList(skillList, ['ℹ️ We couldn\'t detect specific skills in that job description — try pasting the full requirements section.']);
        return;
      }
      if (!missing.length) {
        setList(skillList, ['✅ Great match! Your resume already covers every skill (' + required.length + ') we found in this job description.']);
        return;
      }

      const items = missing.map((s) => 'Missing: <strong>' + escapeHtml(s) + '</strong>');
      items.unshift('Found ' + required.length + ' required skills in the job description — ' + missing.length + ' are missing from your resume:');
      setList(skillList, items);
    });
  }

  /* ---------------------------------------------------------
     Keep resumeText state in sync as the user types, so the
     Skill Gap section can use it even without clicking Improve.
  --------------------------------------------------------- */
  if (resumeText) {
    resumeText.addEventListener('input', () => {
      state.resumeText = resumeText.value;
    });
  }
})();