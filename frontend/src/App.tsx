import React, { useRef, useEffect, useState } from 'react';

interface Detection {
  id: number;
  box: [number, number, number, number];
  center: [number, number];
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [debugMsg, setDebugMsg] = useState<string>("初期化中...");

  // 全画面スタイル
  const fullScreenStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    backgroundColor: 'black',
    zIndex: 1,
  };

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    top: 20,
    left: 20,
    zIndex: 2,
    color: 'white',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: '15px',
    borderRadius: '8px',
    fontFamily: 'monospace',
    pointerEvents: 'none', // クリックを透過
  };

  // 1. WebSocket接続
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8000/ws');
    setSocket(ws);

    ws.onopen = () => console.log("WS Connected");
    ws.onerror = (e) => console.error("WS Error:", e);

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data: Detection[] = JSON.parse(event.data);
        setDetections(data);
      } catch (e) {
        console.error("JSON Parse Error", e);
      }
    };
    return () => ws.close();
  }, []);

  // 2. カメラ起動処理
  useEffect(() => {
    const startVideo = async () => {
      setDebugMsg("カメラ起動を試みています...");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: 640, height: 480 } 
        });
        
        setDebugMsg("カメラ権限OK. ストリーム取得成功.");
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // メタデータ読み込み完了を待ってから再生
          videoRef.current.onloadedmetadata = async () => {
            setDebugMsg(`映像サイズ取得: ${videoRef.current?.videoWidth}x${videoRef.current?.videoHeight}`);
            try {
              await videoRef.current?.play();
              setDebugMsg("映像再生開始 (Playing)");
            } catch (e) {
              setDebugMsg(`再生エラー: ${e}`);
            }
          };
        }
      } catch (err) {
        console.error("Camera Error:", err);
        setDebugMsg(`カメラエラー: ${err}`);
      }
    };
    startVideo();
  }, []);

  // 3. 描画と送信ループ
  useEffect(() => {
    // ソケットが開いてなくても画面描画だけは行うように条件を緩和しても良いが，
    // 今回は送信ロジックとセットにする
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const sendFrame = () => {
      if (videoRef.current && canvasRef.current) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // ビデオの準備ができていない場合はスキップ
        if (video.readyState < 2 || video.videoWidth === 0) {
          return; 
        }

        // キャンバスの解像度をビデオに合わせる
        // これをやらないとCanvasのデフォルトサイズ(300x150)に引き伸ばされて表示されるか，真っ黒になる
        if (canvas.width !== video.videoWidth) {
           canvas.width = video.videoWidth;
           canvas.height = video.videoHeight;
        }

        // --- 描画処理 ---
        // 1. 映像を描画
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // 2. 検知枠を描画
        detections.forEach((d) => {
          const [x1, y1, x2, y2] = d.box;
          ctx.strokeStyle = '#00FF00';
          ctx.lineWidth = 4;
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          
          ctx.fillStyle = '#00FF00';
          ctx.font = 'bold 24px Arial';
          ctx.fillText(`ID:${d.id}`, x1, y1 - 10);
        });

        // 3. 送信
        const base64 = canvas.toDataURL('image/jpeg', 0.5);
        socket.send(base64);
      }
    };

    const interval = setInterval(sendFrame, 100);
    return () => clearInterval(interval);
  }, [socket, detections]);

  return (
    <div>
      {/* 映像キャンバス */}
      <canvas ref={canvasRef} style={fullScreenStyle} />
      
      {/* 隠しvideo要素 */}
      <video ref={videoRef} playsInline muted style={{ display: 'none' }} />

      {/* デバッグ表示パネル（左上に状況が出ます） */}
      <div style={overlayStyle}>
        <h3>System Status</h3>
        <p>Log: {debugMsg}</p>
        <p>検知人数: {detections.length}</p>
        <p>WebSocket: {socket?.readyState === 1 ? "Connected" : "Connecting..."}</p>
      </div>
    </div>
  );
}

export default App;