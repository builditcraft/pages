document.addEventListener('DOMContentLoaded', () => {
    // ==================== 1. アプリの状態管理変数 ====================
    let allQuestions = [];       // CSVから読み込んだ全問題
    let currentQuestions = [];   // 現在のセッションで解く問題リスト
    let currentIndex = 0;        // 現在の問題インデックス (currentQuestions内)
    let currentHistory = [];     // 今回のセッションの履歴 (正誤)
    let currentMode = 'all';     // 現在の学習モード
    let currentDomain = '';      // 選択中のドメイン (domainモード用)
    
    // 永続化するデータ (LocalStorage保存用)
    let progress = {
        history: {},             // 全問題の最新正誤状態 { "問題番号": "correct"|"incorrect" }
        bookmarks: []            // ブックマークされた問題番号の配列 ["問題番号"]
    };

    // CSVファイルのパス
    const CSV_PATH = 'questions.csv';

    // 他のGitHub Pagesアプリとのバッティングを防ぐため、キー名をよりユニークなものに変更
    const STORAGE_KEY_PROGRESS = 'comptia_security_prep_progress';
    const STORAGE_KEY_SESSION = 'comptia_security_prep_saved_session';

    // DOM要素のキャッシュ
    const screens = {
        home: document.getElementById('screen-home'),
        quiz: document.getElementById('screen-quiz'),
        result: document.getElementById('screen-result')
    };

    // ==================== 2. 初期化処理 ====================
    loadProgress();
    loadCSVData();
    setupEventListeners();

    // ==================== 3. データロードとパース ====================
    // LocalStorageから進捗をロード
    function loadProgress() {
        const savedProgress = localStorage.getItem(STORAGE_KEY_PROGRESS);
        if (savedProgress) {
            try {
                progress = JSON.parse(savedProgress);
                if (!progress.history) progress.history = {};
                if (!progress.bookmarks) progress.bookmarks = [];
            } catch (e) {
                console.error("進捗データのパースに失敗しました", e);
            }
        }
    }

    // 進捗をLocalStorageに保存
    function saveProgress() {
        try {
            localStorage.setItem(STORAGE_KEY_PROGRESS, JSON.stringify(progress));
        } catch (e) {
            console.error("進捗データの保存に失敗しました（プライベートモード等の可能性があります）", e);
        }
    }

    // CSVデータを読み込んでパース
    function loadCSVData() {
        Papa.parse(CSV_PATH, {
            download: true,
            header: true,
            skipEmptyLines: true,
            complete: function(results) {
                // 有効な問題データのみをフィルタリング
                allQuestions = results.data.filter(q => q['問題番号'] && q['設問']);
                console.log(`${allQuestions.length} 件の問題を読み込みました。`);
                
                initHome();
                checkSavedSession();
            },
            error: function(err) {
                alert('CSVデータの読み込みに失敗しました。ファイルが存在するか確認してください。');
                console.error(err);
            }
        });
    }

    // ==================== 4. ホーム画面の構築 ====================
    function initHome() {
        // 進捗サマリーの更新
        const totalQCount = allQuestions.length;
        const historyKeys = Object.keys(progress.history);
        const solvedCount = historyKeys.length;
        const correctCount = historyKeys.filter(k => progress.history[k] === 'correct').length;
        const weakCount = historyKeys.filter(k => progress.history[k] === 'incorrect').length;
        
        const solvedRatio = totalQCount > 0 ? Math.round((solvedCount / totalQCount) * 100) : 0;
        const accuracy = solvedCount > 0 ? Math.round((correctCount / solvedCount) * 100) : 0;

        document.getElementById('home-progress-text').textContent = `${solvedCount} / ${totalQCount}問 (${solvedRatio}%)`;
        document.getElementById('home-progress-bar').style.width = `${solvedRatio}%`;
        document.getElementById('home-accuracy-text').textContent = solvedCount > 0 ? `${accuracy}%` : '-- %';
        document.getElementById('home-weak-count').textContent = `${weakCount}問`;

        // 弱点克服ボタンとブックマークボタンの制御
        const weakBtn = document.getElementById('mode-btn-weak');
        if (weakCount > 0) {
            weakBtn.removeAttribute('disabled');
        } else {
            weakBtn.setAttribute('disabled', 'true');
        }

        const bookmarkBtn = document.getElementById('mode-btn-bookmark');
        if (progress.bookmarks.length > 0) {
            bookmarkBtn.removeAttribute('disabled');
        } else {
            bookmarkBtn.setAttribute('disabled', 'true');
        }

        // 分野（ドメイン）リストの生成
        buildDomainList();
        
        // Lucideアイコンの再適用
        lucide.createIcons();
    }

    // 分野（ドメイン）選択アコーディオンの生成
    function buildDomainList() {
        const domainListEl = document.getElementById('domain-list');
        domainListEl.innerHTML = '';

        // 各ドメインの問題数を集計
        const domainCounts = {};
        allQuestions.forEach(q => {
            const domain = q['ドメイン'] || 'その他';
            domainCounts[domain] = (domainCounts[domain] || 0) + 1;
        });

        // ボタンの生成
        Object.keys(domainCounts).sort().forEach(domain => {
            const btn = document.createElement('button');
            btn.className = 'domain-btn';
            btn.innerHTML = `
                <span>${domain}</span>
                <span class="domain-count">${domainCounts[domain]}問</span>
            `;
            btn.addEventListener('click', () => {
                const domainQuestions = allQuestions.filter(q => q['ドメイン'] === domain);
                startNewSession(domainQuestions, 'domain', domain);
            });
            domainListEl.appendChild(btn);
        });
    }

    // 中断セッションのチェック
    function checkSavedSession() {
        const savedSession = localStorage.getItem(STORAGE_KEY_SESSION);
        if (savedSession) {
            try {
                const session = JSON.parse(savedSession);
                // 保存された問題番号リストが有効かチェック
                if (session.qIds && session.qIds.length > 0) {
                    const resumeBtn = document.getElementById('btn-resume');
                    resumeBtn.classList.remove('hidden');
                    
                    // クリックイベントの登録
                    resumeBtn.onclick = () => {
                        resumeSession(session);
                    };
                }
            } catch(e) {
                console.error("セッションの復元に失敗しました", e);
                localStorage.removeItem(STORAGE_KEY_SESSION);
            }
        }
    }

    // ==================== 5. 画面切り替え ====================
    function showScreen(screenId) {
        Object.values(screens).forEach(screen => screen.classList.remove('active'));
        screens[screenId].classList.add('active');
        
        // ホームに戻った場合はデータを更新
        if (screenId === 'home') {
            initHome();
            checkSavedSession();
        }
    }

    // ==================== 6. クイズセッション制御 ====================
    // 新しいセッションを開始する
    function startNewSession(questions, mode, domain = '') {
        // 進行中のデータがあり、かつ新規セッションを開始する場合（結果画面からの再挑戦除く）に上書きの確認を促す
        if (mode !== 'weak_retry' && localStorage.getItem(STORAGE_KEY_SESSION)) {
            const proceed = confirm('進行中の学習データがあります。新しく学習を開始すると、前回の「続きから再開」ができなくなりますが、よろしいですか？');
            if (!proceed) return;
        }

        currentQuestions = [...questions];
        currentMode = mode;
        currentDomain = domain;
        currentIndex = 0;
        currentHistory = [];

        // セッションデータをLocalStorageに保存
        saveCurrentSession();

        // 順次学習スライダーの表示制御と最大値の設定
        const sliderContainer = document.getElementById('quiz-slider-container');
        if (mode === 'all') {
            sliderContainer.classList.remove('hidden');
            const sliderEl = document.getElementById('quiz-start-slider');
            sliderEl.min = 1;
            sliderEl.max = currentQuestions.length;
        } else {
            sliderContainer.classList.add('hidden');
        }
        
        // クイズ画面へ遷移
        showScreen('quiz');
        renderQuestion();
    }

    // 中断されたセッションから再開する
    function resumeSession(session) {
        currentMode = session.mode;
        currentDomain = session.domain || '';
        currentIndex = session.currentIndex;
        currentHistory = session.currentHistory || [];
        
        // 保存された問題番号から対象の問題を再構築
        currentQuestions = session.qIds.map(qNo => {
            return allQuestions.find(q => q['問題番号'] === qNo);
        }).filter(Boolean);

        if (currentQuestions.length === 0) {
            alert('再開する問題データが見つかりませんでした。');
            showScreen('home');
            return;
        }

        showScreen('quiz');
        renderQuestion();
    }

    // 現在のセッション状態を保存
    function saveCurrentSession() {
        const qIds = currentQuestions.map(q => q['問題番号']);
        const sessionData = {
            mode: currentMode,
            domain: currentDomain,
            currentIndex: currentIndex,
            currentHistory: currentHistory,
            qIds: qIds
        };
        try {
            localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(sessionData));
        } catch (e) {
            console.error("セッションの保存に失敗しました", e);
        }
    }

    // セッション一時保存データを削除
    function clearSavedSession() {
        localStorage.removeItem(STORAGE_KEY_SESSION);
        document.getElementById('btn-resume').classList.add('hidden');
    }

    // ==================== 7. 問題の描画と解答判定 ====================
    function renderQuestion() {
        const q = currentQuestions[currentIndex];
        if (!q) return;

        // ヘッダーと進捗
        document.getElementById('quiz-progress-text').textContent = `${currentIndex + 1} / ${currentQuestions.length}`;
        const progressPercent = ((currentIndex + 1) / currentQuestions.length) * 100;
        document.getElementById('quiz-progress-bar-fill').style.width = `${progressPercent}%`;

        // 順次学習スライダーのつまみ位置同期
        if (currentMode === 'all') {
            const sliderEl = document.getElementById('quiz-start-slider');
            if (sliderEl) {
                sliderEl.value = currentIndex + 1;
                document.getElementById('quiz-slider-val').textContent = currentIndex + 1;
                document.getElementById('quiz-slider-total').textContent = currentQuestions.length;
            }
        }

        // ドメインと問題番号
        document.getElementById('quiz-domain-tag').textContent = q['ドメイン'] || 'その他';
        document.getElementById('quiz-qno').textContent = q['問題番号'];
        document.getElementById('quiz-question-text').textContent = q['設問'];

        // ブックマークボタンの状態
        updateBookmarkButtonState(q['問題番号']);

        // 選択肢の構築
        const choicesContainer = document.getElementById('quiz-choices');
        choicesContainer.innerHTML = '';

        // 4つの選択肢オブジェクトを作成
        const rawChoices = [
            { id: 1, text: q['選択肢1'], explanation: q['選択肢1解説'] },
            { id: 2, text: q['選択肢2'], explanation: q['選択肢2解説'] },
            { id: 3, text: q['選択肢3'], explanation: q['選択肢3解説'] },
            { id: 4, text: q['選択肢4'], explanation: q['選択肢4解説'] }
        ].filter(c => c.text); // 空の選択肢を除外

        // 選択肢のシャッフル (フィッシャー・イェーツシャッフル)
        const shuffledChoices = [...rawChoices];
        for (let i = shuffledChoices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledChoices[i], shuffledChoices[j]] = [shuffledChoices[j], shuffledChoices[i]];
        }

        // ボタンの描画
        shuffledChoices.forEach((choice) => {
            const btn = document.createElement('button');
            btn.className = 'choice-btn';
            btn.textContent = choice.text;
            btn.addEventListener('click', () => handleChoiceSelection(choice, rawChoices, q));
            choicesContainer.appendChild(btn);
        });

        // 解説パネルの非表示化
        document.getElementById('explanation-panel').classList.add('hidden');
    }

    // ブックマークボタンの表示更新
    function updateBookmarkButtonState(qNo) {
        const bookmarkBtn = document.getElementById('btn-bookmark');
        if (progress.bookmarks.includes(qNo)) {
            bookmarkBtn.innerHTML = '<i data-lucide="bookmark" style="fill: var(--warning); color: var(--warning)"></i>';
        } else {
            bookmarkBtn.innerHTML = '<i data-lucide="bookmark"></i>';
        }
        lucide.createIcons();
    }

    // 解答選択時の処理
    function handleChoiceSelection(selectedChoice, allRawChoices, question) {
        const choicesContainer = document.getElementById('quiz-choices');
        const buttons = choicesContainer.querySelectorAll('.choice-btn');

        // ボタンの無効化
        buttons.forEach(btn => btn.classList.add('disabled'));

        const isCorrect = (selectedChoice.text === question['正解']);

        // 結果履歴の保存
        currentHistory.push({
            qNo: question['問題番号'],
            isCorrect: isCorrect
        });

        // 全体の履歴（LocalStorage）も更新
        progress.history[question['問題番号']] = isCorrect ? 'correct' : 'incorrect';
        saveProgress();

        // 画面上での視覚フィードバック
        buttons.forEach(btn => {
            if (btn.textContent === question['正解']) {
                btn.classList.add('correct');
            } else if (btn.textContent === selectedChoice.text && !isCorrect) {
                btn.classList.add('incorrect');
            }
        });

        // セッション状態の保存
        saveCurrentSession();

        // 解説パネルの表示
        showExplanationPanel(isCorrect, selectedChoice, allRawChoices, question);
    }

    // 解説パネルの構築と表示
    function showExplanationPanel(isCorrect, selectedChoice, allRawChoices, question) {
        const panel = document.getElementById('explanation-panel');
        const banner = document.getElementById('result-banner');
        const icon = document.getElementById('result-icon');
        const text = document.getElementById('result-text');
        
        panel.classList.remove('hidden');

        // 正解・不正解バナーの切り替え
        if (isCorrect) {
            banner.className = 'result-banner success';
            icon.innerHTML = '<i data-lucide="check-circle-2"></i>';
            text.textContent = '正解！';
        } else {
            banner.className = 'result-banner danger';
            icon.innerHTML = '<i data-lucide="x-circle"></i>';
            text.textContent = '不正解...';
        }
        lucide.createIcons();

        // 解説タブの生成
        const tabsContainer = document.getElementById('explanation-tabs');
        tabsContainer.innerHTML = '';

        allRawChoices.forEach((choice, idx) => {
            const tabBtn = document.createElement('button');
            tabBtn.className = 'tab-btn';
            tabBtn.textContent = `選択肢 ${idx + 1}`;
            
            // 正解の選択肢にマーク
            if (choice.text === question['正解']) {
                tabBtn.classList.add('correct-tab');
                tabBtn.textContent += ' (正解)';
            }
            // 自分が選んだ間違った選択肢にマーク
            if (choice.text === selectedChoice.text && !isCorrect) {
                tabBtn.textContent += ' (選択)';
            }

            tabBtn.addEventListener('click', () => {
                // アクティブタブの切り替え
                tabsContainer.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
                tabBtn.classList.add('active');
                
                // 解説テキストの表示
                displayExplanationText(choice);
            });

            tabsContainer.appendChild(tabBtn);
        });

        // 初期状態で表示する解説を選択
        // 不正解の場合は自分が選んだ選択肢の解説、正解の場合は正解の選択肢の解説を最初に表示
        const targetChoice = isCorrect 
            ? allRawChoices.find(c => c.text === question['正解']) 
            : selectedChoice;
        
        const targetIndex = allRawChoices.findIndex(c => c.text === targetChoice.text);
        if (targetIndex !== -1) {
            const tabs = tabsContainer.querySelectorAll('.tab-btn');
            if (tabs[targetIndex]) {
                tabs[targetIndex].classList.add('active');
                displayExplanationText(targetChoice);
            }
        }
    }

    // 解説テキストの差し替え表示
    function displayExplanationText(choice) {
        const textBox = document.getElementById('explanation-text-box');
        // 解説が空の場合は「解説はありません。」と表示
        const expText = choice.explanation ? choice.explanation : 'この選択肢の解説はありません。';
        textBox.innerHTML = `<strong>${choice.text}</strong><br><br>${expText}`;
    }

    // 次の問題に進む
    function nextQuestion() {
        currentIndex++;
        if (currentIndex < currentQuestions.length) {
            saveCurrentSession();
            renderQuestion();
            // クイズ表示エリアを最上部にスクロール
            screens.quiz.scrollTop = 0;
        } else {
            showResult();
        }
    }

    // ==================== 8. リザルト画面の処理 ====================
    function showResult() {
        // セッションが完了したため、中断セッションデータを削除
        clearSavedSession();

        const total = currentHistory.length;
        const correct = currentHistory.filter(h => h.isCorrect).length;
        const incorrect = total - correct;
        const scorePercent = total > 0 ? Math.round((correct / total) * 100) : 0;

        document.getElementById('result-score-ratio').textContent = `${scorePercent}%`;
        document.getElementById('result-total-count').textContent = `${total}問`;
        document.getElementById('result-correct-count').textContent = `${correct}問`;
        document.getElementById('result-incorrect-count').textContent = `${incorrect}問`;

        // 「間違えた問題に再挑戦する」ボタンの表示制御
        const retryWeakBtn = document.getElementById('btn-retry-weak');
        if (incorrect > 0) {
            retryWeakBtn.classList.remove('hidden');
            
            // イベントハンドラの設定
            retryWeakBtn.onclick = () => {
                const incorrectQNos = currentHistory.filter(h => !h.isCorrect).map(h => h.qNo);
                const weakQuestions = allQuestions.filter(q => incorrectQNos.includes(q['問題番号']));
                startNewSession(weakQuestions, 'weak_retry');
            };
        } else {
            retryWeakBtn.classList.add('hidden');
        }

        showScreen('result');
    }

    // ==================== 9. イベントリスナーの設定 ====================
    function setupEventListeners() {
        // ホーム画面の学習モード選択
        const modeCards = document.querySelectorAll('.mode-card');
        modeCards.forEach(card => {
            card.addEventListener('click', () => {
                const mode = card.getAttribute('data-mode');
                
                if (mode === 'all') {
                    // 全問順次
                    startNewSession(allQuestions, 'all');
                } else if (mode === 'weak') {
                    // 弱点克服 (履歴で不正解のもの)
                    const weakQNos = Object.keys(progress.history).filter(k => progress.history[k] === 'incorrect');
                    const weakQuestions = allQuestions.filter(q => weakQNos.includes(q['問題番号']));
                    startNewSession(weakQuestions, 'weak');
                } else if (mode === 'bookmark') {
                    // ブックマークされた問題
                    const bookmarkedQuestions = allQuestions.filter(q => progress.bookmarks.includes(q['問題番号']));
                    startNewSession(bookmarkedQuestions, 'bookmark');
                } else if (mode === 'domain') {
                    // 分野（ドメイン）別選択リストの表示トグル
                    const container = document.getElementById('domain-selector-container');
                    container.classList.toggle('hidden');
                    if (!container.classList.contains('hidden')) {
                        container.scrollIntoView({ behavior: 'smooth' });
                    }
                }
            });
        });

        // クイズ画面：問題選択スライダーの入力イベント
        const quizSlider = document.getElementById('quiz-start-slider');
        if (quizSlider) {
            quizSlider.addEventListener('input', (e) => {
                const val = parseInt(e.target.value, 10);
                currentIndex = val - 1;
                saveCurrentSession();
                renderQuestion();
                document.getElementById('explanation-panel').classList.add('hidden');
            });
        }

        // クイズ画面：戻るボタン
        document.getElementById('btn-quiz-back').addEventListener('click', () => {
            if (confirm('学習を中断してホームに戻りますか？現在の進捗は保存されます。')) {
                showScreen('home');
            }
        });

        // クイズ画面：ブックマーク切り替え
        document.getElementById('btn-bookmark').addEventListener('click', () => {
            const q = currentQuestions[currentIndex];
            if (!q) return;

            const qNo = q['問題番号'];
            const idx = progress.bookmarks.indexOf(qNo);

            if (idx === -1) {
                progress.bookmarks.push(qNo);
            } else {
                progress.bookmarks.splice(idx, 1);
            }
            
            saveProgress();
            updateBookmarkButtonState(qNo);
        });

        // クイズ画面：次の問題へ
        document.getElementById('btn-next-question').addEventListener('click', () => {
            nextQuestion();
        });

        // リザルト画面：ホームに戻る
        document.getElementById('btn-result-home').addEventListener('click', () => {
            showScreen('home');
        });
    }
});
