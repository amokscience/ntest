import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [target, setTarget] = useState('');
  const [protocol, setProtocol] = useState('all');
  const [port, setPort] = useState('');
  const [timeout, setTimeout] = useState('10');
  const [results, setResults] = useState([]);
  const [testing, setTesting] = useState(false);
  const [tracerouting, setTracerouting] = useState(false);
  const [tracerouteResult, setTracerouteResult] = useState('');
  const [currentTest, setCurrentTest] = useState('');
  const [error, setError] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [systemInfo, setSystemInfo] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Use relative URL when embedded, or environment variable for development
  const API_URL = process.env.REACT_APP_API_URL || '';

  // Fetch system info on component mount
  useEffect(() => {
    const fetchSystemInfo = async () => {
      try {
        const response = await fetch(`${API_URL}/api/sysinfo`);
        if (response.ok) {
          const data = await response.json();
          setSystemInfo(data);
        }
      } catch (err) {
        console.error('Failed to fetch system info:', err);
      }
    };

    fetchSystemInfo();

    // Update timestamp every second
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, [API_URL]);

  const handleProtocolChange = (e) => {
    const newProtocol = e.target.value;
    setProtocol(newProtocol);
    // Clear port if ping is selected (ping doesn't use ports)
    if (newProtocol === 'ping') {
      setPort('');
    }
  };

  const handleTest = async () => {
    if (!target) {
      setError('Please enter a target IP or domain name');
      return;
    }

    setTesting(true);
    setError('');
    setResults([]);
    setCurrentTest('');

    try {
      // Use fetch with streaming for Server-Sent Events
      const response = await fetch(`${API_URL}/api/test/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          target,
          protocol,
          port,
          timeout: parseInt(timeout) || 10
        })
      });

      if (!response.ok) {
        throw new Error('Request failed');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'testing') {
              setCurrentTest(data.protocol);
            } else if (data.type === 'result') {
              setResults(prev => [...prev, data.result]);
              setCurrentTest('');
            } else if (data.type === 'complete') {
              setTesting(false);
              setShowSuccess(true);
              setTimeout(() => setShowSuccess(false), 5000);
            }
          }
        }
      }
    } catch (err) {
      setError(err.message || 'An error occurred during testing');
      setTesting(false);
    }
  };

  const handleTraceroute = async () => {
    if (!target) {
      setError('Please enter a target IP or domain name');
      return;
    }

    setTracerouting(true);
    setError('');
    setTracerouteResult('Running traceroute...');

    try {
      const response = await fetch(`${API_URL}/api/traceroute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          target
        })
      });

      if (!response.ok) {
        throw new Error('Request failed');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            setTracerouteResult(data.message);
          }
        }
      }
    } catch (err) {
      setError(err.message || 'An error occurred during traceroute');
      setTracerouteResult('');
    } finally {
      setTracerouting(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleTest();
    }
  };

  return (
    <div className="App">
      {showSuccess && (
        <div className="toast-notification">
          <div className="toast-content">
            <span className="toast-icon">✓</span>
            <span className="toast-message">Tests completed successfully!</span>
            <button className="toast-close" onClick={() => setShowSuccess(false)}>×</button>
          </div>
        </div>
      )}

      {/* System Info Panel */}
      {systemInfo && (
        <div className="system-info-panel">
          <div className="info-header">📊 System Information</div>
          <div className="info-item">
            <span className="info-label">Timestamp:</span>
            <span className="info-value">{currentTime.toLocaleString()}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Hostname:</span>
            <span className="info-value">{systemInfo.hostname}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Host IPs:</span>
            <span className="info-value">
              {systemInfo.hostIps && systemInfo.hostIps.length > 0 ? (
                systemInfo.hostIps.map((ip, idx) => (
                  <div key={idx}>{ip}</div>
                ))
              ) : (
                'N/A'
              )}
            </span>
          </div>
          <div className="info-item">
            <span className="info-label">DNS Servers:</span>
            <span className="info-value">
              {systemInfo.dnsServers && systemInfo.dnsServers.length > 0 ? (
                systemInfo.dnsServers.map((dns, idx) => (
                  <div key={idx}>{dns}</div>
                ))
              ) : (
                'N/A'
              )}
            </span>
          </div>
          <div className="info-item">
            <span className="info-label">Gateway IPs:</span>
            <span className="info-value">
              {systemInfo.gatewayIps && systemInfo.gatewayIps.length > 0 ? (
                systemInfo.gatewayIps.map((gw, idx) => (
                  <div key={idx}>{gw}</div>
                ))
              ) : (
                'N/A'
              )}
            </span>
          </div>
        </div>
      )}
      
      <div className="container">
        <h1>🌐 Network Connectivity Tester</h1>
        <p className="subtitle">Test network connectivity to any endpoint</p>

        <div className="form-container">
          <div className="form-group">
            <label htmlFor="target">Target IP or Domain:</label>
            <input
              id="target"
              type="text"
              placeholder="e.g., google.com or 8.8.8.8"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={testing}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="protocol">Protocol:</label>
              <select
                id="protocol"
                value={protocol}
                onChange={handleProtocolChange}
                disabled={testing}
              >
                <option value="all">All</option>
                <option value="ping">Ping</option>
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="port">
                Port (optional):
                {protocol === 'ping' && <span style={{fontSize: '0.85em', color: '#999', marginLeft: '8px'}}>N/A for PING</span>}
              </label>
              <input
                id="port"
                type="text"
                placeholder="e.g., 80, 443"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                onKeyPress={handleKeyPress}
                disabled={testing || protocol === 'ping'}
              />
            </div>

            <div className="form-group">
              <label htmlFor="timeout">Timeout (seconds):</label>
              <input
                id="timeout"
                type="number"
                min="1"
                max="60"
                placeholder="10"
                value={timeout}
                onChange={(e) => setTimeout(e.target.value)}
                onKeyPress={handleKeyPress}
                disabled={testing}
              />
            </div>
          </div>

          <button
            className="test-button"
            onClick={handleTest}
            disabled={testing || tracerouting}
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>

        {/* Traceroute Section */}
        <div className="traceroute-section">
          <div className="traceroute-header">
            <h3>🔍 Traceroute</h3>
            <button
              className="traceroute-button"
              onClick={handleTraceroute}
              disabled={testing || tracerouting}
            >
              {tracerouting ? 'Running...' : 'Run Traceroute'}
            </button>
          </div>
          
          {tracerouteResult && (
            <div className="traceroute-result">
              <pre>{tracerouteResult}</pre>
            </div>
          )}
        </div>

        {error && (
          <div className="error-message">
            <strong>Error:</strong> {error}
          </div>
        )}

        {results.length > 0 && (
          <div className="results-container">
            <h2>Test Results</h2>
            {results.map((result, index) => (
              <div
                key={index}
                className={`result-item ${result.success ? 'success' : 'failure'}`}
              >
                <div className="result-header">
                  <span className="protocol-badge">
                    {result.protocol.toUpperCase()}
                  </span>
                  <span className={`status-badge ${result.success ? 'status-success' : 'status-failure'}`}>
                    {result.success ? '✓ Success' : '✗ Failed'}
                  </span>
                  <span className="duration">{result.duration}</span>
                </div>
                <div className="result-message">
                  {result.message}
                </div>
              </div>
            ))}
          </div>
        )}

        {testing && (
          <div className="testing-indicator">
            <div className="spinner"></div>
            {currentTest ? (
              <p>Running {currentTest.toUpperCase()} test... (timeout: {timeout}s)</p>
            ) : (
              <p>Preparing tests...</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
