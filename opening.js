// ════════════════════════════════════════════════════════════
// نظام صناعة وحفظ الافتتاحيات (Opening Book Recorder)
// يتم حقن هذا الملف بعد السكربت الرئيسي في a.html
// ════════════════════════════════════════════════════════════

(function () {

    // ─────────────────────────────────────
    // مفاتيح التخزين في localStorage
    // ─────────────────────────────────────
    var STORAGE_KEY_WHITE = 'gmElgindy_openingBook_white';
    var STORAGE_KEY_BLACK = 'gmElgindy_openingBook_black';

    // الكتب الحالية (مصفوفات SAN) التي يستخدمها المحرك فعلياً
    var openingBookWhite = [];
    var openingBookBlack = [];

    // ─────────────────────────────────────
    // تفكيك الـ PGN إلى مصفوفة نقلات (متوافق مع chess.js 0.10.3)
    // ─────────────────────────────────────
    function parsePgnToMoves(pgnString) {
        if (!pgnString) return [];
        var tempGame = new Chess();
        if (tempGame.load_pgn(pgnString)) {
            return tempGame.history();
        }
        console.error('Error in saved PGN format!');
        return [];
    }

    function loadBooksFromStorage() {
        var pgnWhite = localStorage.getItem(STORAGE_KEY_WHITE) || '';
        var pgnBlack = localStorage.getItem(STORAGE_KEY_BLACK) || '';
        openingBookWhite = parsePgnToMoves(pgnWhite);
        openingBookBlack = parsePgnToMoves(pgnBlack);
    }

    loadBooksFromStorage();

    // ─────────────────────────────────────
    // إجبار المحرك على لعب الافتتاح المحفوظ
    // (Override لدالة askBotToMove الأصلية)
    // ─────────────────────────────────────
    askBotToMove = function () {
        if (game.game_over() || !engine) return;

        var history = game.history();
        var currentPly = history.length;

        // لون المحرك هو عكس لون اللاعب
        var activeBook = (playerColor === 'b') ? openingBookWhite : openingBookBlack;

        if (currentPly < activeBook.length) {
            var isMatching = true;
            for (var i = 0; i < currentPly; i++) {
                if (history[i] !== activeBook[i]) { isMatching = false; break; }
            }

            if (isMatching) {
                var nextMove = activeBook[currentPly];
                setTimeout(function () {
                    var move = game.move(nextMove);
                    if (move) {
                        board.position(game.fen());
                        var botColor = playerColor === 'w' ? 'b' : 'w';
                        addLog(move.san, botColor);
                        playMoveSound(move.flags, game.in_check());
                        switchClock();
                        updateUI();
                        if (game.game_over()) { sfx.end(); stopClock(); }
                    }
                }, 600);
                return; // لا نستدعي Stockfish في هذه النقلة
            }
        }

        // انتهى الافتتاح أو انحرف اللاعب عنه: يبدأ Stockfish فوراً
        engine.postMessage('position fen ' + game.fen());
        engine.postMessage('go depth ' + botDepth);
    };

    // ─────────────────────────────────────
    // حقن واجهة التحكم داخل .left-panel
    // ─────────────────────────────────────
    var panelHtml =
        '<div class="settings-group" id="opening-recorder-group">' +
            '<div class="group-title">Create Engine Opening</div>' +
            '<div style="display:flex;flex-direction:column;gap:6px;">' +
                '<button class="btn-apply" id="btn-rec-start">▶ Start Recording Opening</button>' +
                '<button class="btn-apply" id="btn-rec-save-white" disabled>💾 Save for Engine (as White)</button>' +
                '<button class="btn-apply" id="btn-rec-save-black" disabled>💾 Save for Engine (as Black)</button>' +
                '<button class="btn-apply" id="btn-rec-cancel" disabled style="border-color:#a33;color:#f88;">✖ Cancel Recording</button>' +
            '</div>' +
            '<div id="rec-log" style="margin-top:6px;font-size:0.8em;color:#888;min-height:1.2em;line-height:1.5;"></div>' +
        '</div>' +
        '<div class="settings-group" id="opening-backup-group">' +
            '<div class="group-title">Book Backup</div>' +
            '<div style="display:flex;flex-direction:column;gap:6px;">' +
                '<button class="btn-apply" id="btn-book-export">⬇ Export Book</button>' +
                '<button class="btn-apply" id="btn-book-import">⬆ Import Book</button>' +
                '<button class="btn-apply" id="btn-book-copy">📋 Copy Book Text</button>' +
                '<input type="file" id="book-import-file" accept=".json" style="display:none;">' +
            '</div>' +
            '<div id="book-backup-log" style="margin-top:6px;font-size:0.8em;color:#888;min-height:1.2em;line-height:1.5;"></div>' +
        '</div>';

    function injectUI() {
        $('.left-panel').append(panelHtml);

        $('#btn-rec-start').on('click', startRecording);
        $('#btn-rec-save-white').on('click', function () { saveRecording('w'); });
        $('#btn-rec-save-black').on('click', function () { saveRecording('b'); });
        $('#btn-rec-cancel').on('click', cancelRecording);

        $('#btn-book-export').on('click', exportBook);
        $('#btn-book-import').on('click', function () { $('#book-import-file').trigger('click'); });
        $('#book-import-file').on('change', importBookFile);
        $('#btn-book-copy').on('click', copyBookText);
    }

    // ─────────────────────────────────────
    // منطق وضع التسجيل
    // ─────────────────────────────────────
    var recordingMode = false;
    var recordedGame = null;

    // حفظ المراجع الأصلية لدوال السحب قبل أي تعديل (تُستخدم عند العودة من التسجيل)
    var originalOnDragStart = window.onDragStart;
    var originalOnDrop = window.onDrop;
    var originalOnSnapEnd = window.onSnapEnd;

    function startRecording() {
        initAudio();
        recordingMode = true;
        recordedGame = new Chess();

        // إيقاف المحرك تماماً
        if (engine) { try { engine.postMessage('stop'); } catch (e) {} }
        stopClock();

        // تفريغ الرقعة والبدء من الوضع الافتتاحي القياسي
        board.position('start');
        $('#rec-log').html('Recording mode: start by moving White then Black alternately...');
        $('#status-txt').text('🔴 Opening recording mode active');

        // تفعيل/تعطيل الأزرار المناسبة
        $('#btn-rec-start').prop('disabled', true);
        $('#btn-rec-save-white, #btn-rec-save-black, #btn-rec-cancel').prop('disabled', false);

        // تحويل دوال السحب إلى دوال التسجيل
        window.onDragStart = recordingOnDragStart;
        window.onDrop = recordingOnDrop;
        window.onSnapEnd = recordingOnSnapEnd;
    }

    function recordingOnDragStart(source, piece) {
        if (!recordingMode || recordedGame.game_over()) return false;
        if ((recordedGame.turn() === 'w' && piece.search(/^b/) !== -1) ||
            (recordedGame.turn() === 'b' && piece.search(/^w/) !== -1)) return false;
    }

    function recordingOnDrop(source, target) {
        var move = recordedGame.move({ from: source, to: target, promotion: 'q' });
        if (move === null) return 'snapback';

        if (move.flags && (move.flags.indexOf('c') > -1 || move.flags.indexOf('e') > -1)) sfx.capture();
        else sfx.move();

        updateRecordingLog();
    }

    function recordingOnSnapEnd() {
        board.position(recordedGame.fen());
    }

    function updateRecordingLog() {
        var pgn = recordedGame.pgn();
        $('#rec-log').text(pgn || '...');
    }

    function stopRecordingMode() {
        recordingMode = false;
        window.onDragStart = originalOnDragStart;
        window.onDrop = originalOnDrop;
        window.onSnapEnd = originalOnSnapEnd;

        $('#btn-rec-start').prop('disabled', false);
        $('#btn-rec-save-white, #btn-rec-save-black, #btn-rec-cancel').prop('disabled', true);
        $('#rec-log').text('');
    }

    function saveRecording(color) {
        if (!recordingMode || !recordedGame) return;
        var movesCount = recordedGame.history().length;
        if (movesCount === 0) {
            alert('No moves recorded yet!');
            return;
        }

        var pgn = recordedGame.pgn();
        if (color === 'w') {
            localStorage.setItem(STORAGE_KEY_WHITE, pgn);
        } else {
            localStorage.setItem(STORAGE_KEY_BLACK, pgn);
        }

        // إعادة تحميل الكتب في الذاكرة فوراً
        loadBooksFromStorage();

        stopRecordingMode();
        $('#status-txt').text('✅ ' + (color === 'w' ? 'White' : 'Black') + ' opening saved successfully');

        // العودة للعب طبيعي
        resetGame();
    }

    function cancelRecording() {
        if (!recordingMode) return;
        stopRecordingMode();
        $('#status-txt').text('Recording cancelled');
        resetGame();
    }

    // ─────────────────────────────────────
    // نسخ احتياطي للكتاب: تصدير / استيراد / نسخ نص
    // ─────────────────────────────────────
    function exportBook() {
        var pgnWhite = localStorage.getItem(STORAGE_KEY_WHITE) || '';
        var pgnBlack = localStorage.getItem(STORAGE_KEY_BLACK) || '';
        if (!pgnWhite && !pgnBlack) {
            $('#book-backup-log').text('No saved openings to export yet.');
            return;
        }
        var data = { white: pgnWhite, black: pgnBlack };
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'opening-book.json';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        $('#book-backup-log').text('✅ Book exported.');
    }

    function importBookFile(e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (evt) {
            try {
                var data = JSON.parse(evt.target.result);
                if (data.white) localStorage.setItem(STORAGE_KEY_WHITE, data.white);
                if (data.black) localStorage.setItem(STORAGE_KEY_BLACK, data.black);
                loadBooksFromStorage();
                $('#book-backup-log').text('✅ Book imported successfully.');
            } catch (err) {
                $('#book-backup-log').text('⚠ Invalid file format.');
            }
            $('#book-import-file').val('');
        };
        reader.readAsText(file);
    }

    function copyBookText() {
        var pgnWhite = localStorage.getItem(STORAGE_KEY_WHITE) || '';
        var pgnBlack = localStorage.getItem(STORAGE_KEY_BLACK) || '';
        if (!pgnWhite && !pgnBlack) {
            $('#book-backup-log').text('No saved openings to copy yet.');
            return;
        }
        var text = JSON.stringify({ white: pgnWhite, black: pgnBlack }, null, 2);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                $('#book-backup-log').text('📋 Copied to clipboard.');
            }).catch(function () {
                $('#book-backup-log').text('⚠ Copy failed, please copy manually.');
            });
        } else {
            $('#book-backup-log').text('⚠ Clipboard not supported in this browser.');
        }
    }

    // ─────────────────────────────────────
    // التهيئة بعد جاهزية الصفحة (بعد إنشاء board في السكربت الرئيسي)
    // ─────────────────────────────────────
    $(function () {
        // تحديث المراجع الأصلية بعد أن يكون board جاهزاً فعلياً
        originalOnDragStart = window.onDragStart;
        originalOnDrop = window.onDrop;
        originalOnSnapEnd = window.onSnapEnd;
        injectUI();
    });

})();
