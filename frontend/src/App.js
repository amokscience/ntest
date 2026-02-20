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
  const [dnsResult, setDnsResult] = useState(null);
  const [dnsLoading, setDnsLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  // Use relative URL when embedded, or environment variable for development
  const API_URL = process.env.REACT_APP_API_URL || '';

  // Fetch system info and load history on component mount
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

    // Load history from localStorage
    const savedHistory = localStorage.getItem('targetHistory');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (err) {
        console.error('Failed to load history:', err);
      }
    }

    fetchSystemInfo();

    // Update timestamp every second
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, [API_URL]);

  // Clear results when target changes
  useEffect(() => {
    setResults([]);
    setTracerouteResult('');
    setDnsResult(null);
  }, [target]);

  const handleProtocolChange = (e) => {
    const newProtocol = e.target.value;
    setProtocol(newProtocol);
    // Clear port if ping is selected (ping doesn't use ports)
    if (newProtocol === 'ping') {
      setPort('');
    }
  };

  const addToHistory = (entry) => {
    if (!entry.trim()) return;
    
    // Create new history with this entry at the front, removing duplicates
    const newHistory = [entry, ...history.filter(item => item !== entry)].slice(0, 10);
    setHistory(newHistory);
    localStorage.setItem('targetHistory', JSON.stringify(newHistory));
  };

  const selectFromHistory = (entry) => {
    setTarget(entry);
    setShowHistory(false);
  };

  const removeFromHistory = (entry) => {
    const newHistory = history.filter(item => item !== entry);
    setHistory(newHistory);
    localStorage.setItem('targetHistory', JSON.stringify(newHistory));
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
              addToHistory(target);
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
    setTracerouteResult('Starting traceroute...\n');

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
            
            if (data.type === 'line') {
              // Append each line as it arrives
              setTracerouteResult(prev => prev + data.text + '\n');
            } else if (data.type === 'complete') {
              // Add completion message
              setTracerouteResult(prev => prev + '\n' + data.message);
              setTracerouting(false);
            }
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

  const isHostname = (str) => {
    // Check if string is NOT an IP address
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
    return !ipv4Regex.test(str) && !ipv6Regex.test(str) && str.length > 0;
  };

  const handleDNSLookup = async () => {
    if (!target) {
      setError('Please enter a hostname');
      return;
    }

    if (!isHostname(target)) {
      setError('DNS lookup only works with hostnames, not IP addresses');
      return;
    }

    setDnsLoading(true);
    setError('');
    setDnsResult(null);

    try {
      const response = await fetch(`${API_URL}/api/dns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          hostname: target
        })
      });

      if (!response.ok) {
        throw new Error('DNS lookup failed');
      }

      const data = await response.json();
      setDnsResult(data);
    } catch (err) {
      setError(err.message || 'DNS lookup failed');
    } finally {
      setDnsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleTest();
    }
  };

  const handleSetLocalIP = () => {
    if (systemInfo && systemInfo.hostIps && systemInfo.hostIps.length > 0) {
      // Prefer IPv4 over IPv6
      const ipv4 = systemInfo.hostIps.find(ip => !ip.includes(':'));
      setTarget(ipv4 || systemInfo.hostIps[0]);
    }
  };

  const handleClear = () => {
    setResults([]);
    setTracerouteResult('');
    setDnsResult(null);
    setError('');
  };

  return (
    <div className="App">
      {showSuccess && (
        <div className="alert alert-success alert-dismissible fade show position-fixed top-0 end-0 m-3" role="alert" style={{zIndex: 9999}}>
          <strong>Success!</strong> Tests completed successfully!
          <button type="button" className="btn-close" onClick={() => setShowSuccess(false)}></button>
        </div>
      )}

      <div className="container-fluid">
        <div className="row pt-1">
          {/* Left Column: System Info Panel */}
          <div className="col-lg-3 mb-4">
            {systemInfo && (
              <div className="card sticky-top" style={{top: '20px'}}>
                <div className="card-header bg-primary text-white">
                  <h5 className="mb-0">📊 System Information</h5>
                </div>
                <div className="card-body p-3">
                  <div className="mb-2">
                    <small className="text-muted d-block fw-bold">Timestamp</small>
                    <small>{currentTime.toLocaleString()}</small>
                  </div>
                  <div className="mb-2">
                    <small className="text-muted d-block fw-bold">OS</small>
                    <small>{systemInfo.os || 'Unknown'}</small>
                  </div>
                  <div className="mb-2">
                    <small className="text-muted d-block fw-bold">Hostname</small>
                    <small>{systemInfo.hostname}</small>
                  </div>
                  <div className="mb-2">
                    <small className="text-muted d-block fw-bold">Host IPs</small>
                    {systemInfo.hostIps && systemInfo.hostIps.length > 0 ? (
                      systemInfo.hostIps.map((ip, idx) => (
                        <small key={idx} className="d-block">{ip}</small>
                      ))
                    ) : (
                      <small>N/A</small>
                    )}
                  </div>
                  <div className="mb-2">
                    <small className="text-muted d-block fw-bold">DNS Servers</small>
                    {systemInfo.dnsServers && systemInfo.dnsServers.length > 0 ? (
                      systemInfo.dnsServers.map((dns, idx) => (
                        <small key={idx} className="d-block">{dns}</small>
                      ))
                    ) : (
                      <small>N/A</small>
                    )}
                  </div>
                  <div className="mb-2">
                    <small className="text-muted d-block fw-bold">Gateway IPs</small>
                    {systemInfo.gatewayIps && systemInfo.gatewayIps.length > 0 ? (
                      systemInfo.gatewayIps.map((gw, idx) => (
                        <small key={idx} className="d-block">{gw}</small>
                      ))
                    ) : (
                      <small>N/A</small>
                    )}
                  </div>
                  {systemInfo.networkInterfaces && systemInfo.networkInterfaces.length > 0 && (
                    <div className="mt-3">
                      <small className="text-muted d-block fw-bold mb-2">Network Interfaces</small>
                      {systemInfo.networkInterfaces.map((iface, idx) => (
                        <div key={idx} className="border-top pt-2">
                          <small className="d-block fw-bold">
                            {iface.name}
                            <span className={`badge ms-2 ${iface.status === 'Up' ? 'bg-success' : 'bg-danger'}`}>
                              {iface.status}
                            </span>
                          </small>
                          <small className="d-block">IP: {iface.ipAddress}</small>
                          <small className="d-block">Mask: {iface.subnetMask}</small>
                          <small className="d-block text-truncate" title={iface.macAddress}>MAC: {iface.macAddress}</small>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Main Form */}
          <div className="col-lg-9">
            <div className="card">
              <div className="card-body">
                <h1 className="card-title mb-2">🌐 Network Connectivity Tester</h1>
                <p className="text-muted">Test network connectivity to any endpoint</p>

                <div className="mb-3">
                  <label htmlFor="target" className="form-label">Target IP or Domain</label>
                  <div className="position-relative">
                    <div className="input-group">
                      <input
                        id="target"
                        type="text"
                        className="form-control"
                        placeholder="e.g., google.com or 8.8.8.8"
                        value={target}
                        onChange={(e) => setTarget(e.target.value)}
                        onKeyPress={handleKeyPress}
                        onFocus={() => setShowHistory(true)}
                        onBlur={() => setTimeout(() => setShowHistory(false), 200)}
                        disabled={testing}
                      />
                      <button
                        className="btn btn-outline-secondary"
                        type="button"
                        onClick={handleSetLocalIP}
                        disabled={testing || !systemInfo || !systemInfo.hostIps || systemInfo.hostIps.length === 0}
                        title="Set local IP address"
                      >
                        Local IP
                      </button>
                    </div>
                    {showHistory && history.length > 0 && (
                      <div className="list-group position-absolute w-100 mt-1" style={{zIndex: 10, maxHeight: '250px', overflowY: 'auto'}}>
                        {history.map((entry, idx) => (
                          <div key={idx} className="list-group-item list-group-item-action">
                            <div className="d-flex justify-content-between align-items-center">
                              <button
                                type="button"
                                className="btn btn-link p-0 text-start text-decoration-none flex-grow-1"
                                onMouseDown={() => selectFromHistory(entry)}
                              >
                                {entry}
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-close"
                                onMouseDown={() => removeFromHistory(entry)}
                                title="Remove from history"
                              ></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="row">
                  <div className="col-md-4 mb-3">
                    <label htmlFor="protocol" className="form-label">Protocol</label>
                    <select
                      id="protocol"
                      className="form-select"
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

                  <div className="col-md-4 mb-3">
                    <label htmlFor="port" className="form-label">
                      Port {protocol === 'ping' && <span className="text-muted" style={{fontSize: '0.85em'}}>(N/A for PING)</span>}
                    </label>
                    <input
                      id="port"
                      type="text"
                      className="form-control"
                      placeholder="e.g., 80, 443"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      onKeyPress={handleKeyPress}
                      disabled={testing || protocol === 'ping'}
                    />
                  </div>

                  <div className="col-md-4 mb-3">
                    <label htmlFor="timeout" className="form-label">Timeout (seconds)</label>
                    <input
                      id="timeout"
                      type="number"
                      className="form-control"
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

                <div className="mb-3">
                  <div className="row g-2">
                    <div className="col-md-3">
                      <button
                        className="btn btn-primary w-100"
                        onClick={handleTest}
                        disabled={testing || tracerouting}
                      >
                        {testing ? (
                          <>
                            <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                            Testing...
                          </>
                        ) : (
                          'Test Connection'
                        )}
                      </button>
                    </div>
                    <div className="col-md-3">
                      <button
                        className="btn btn-info w-100"
                        onClick={handleDNSLookup}
                        disabled={testing || tracerouting || dnsLoading || !isHostname(target)}
                      >
                        {dnsLoading ? (
                          <>
                            <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                            Looking up...
                          </>
                        ) : (
                          '🔎 DNS Lookup'
                        )}
                      </button>
                    </div>
                    <div className="col-md-3">
                      <button
                        className="btn btn-success w-100"
                        onClick={handleTraceroute}
                        disabled={testing || tracerouting}
                      >
                        {tracerouting ? (
                          <>
                            <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                            Running...
                          </>
                        ) : (
                          '🔍 Traceroute'
                        )}
                      </button>
                    </div>
                    <div className="col-md-3">
                      <button
                        className="btn btn-secondary w-100"
                        onClick={handleClear}
                        disabled={testing || tracerouting}
                      >
                        Clear Results
                      </button>
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="alert alert-danger" role="alert">
                    <strong>Error:</strong> {error}
                  </div>
                )}

                {(results.length > 0 || tracerouteResult || dnsResult) && (
                  <div>
                    <h5 className="mb-3">Results</h5>

                    {dnsResult && (
                      <div className={`alert ${dnsResult.success ? 'alert-info' : 'alert-danger'}`} role="alert">
                        <div className="mb-2">
                          <strong>🔎 DNS Lookup for: {dnsResult.hostname}</strong>
                        </div>
                        {dnsResult.success ? (
                          <div>
                            <small className="d-block">Resolved addresses:</small>
                            {dnsResult.addresses && dnsResult.addresses.map((addr, idx) => (
                              <small key={idx} className="d-block font-monospace">{addr}</small>
                            ))}
                          </div>
                        ) : (
                          <small className="d-block">{dnsResult.message}</small>
                        )}
                      </div>
                    )}

                    {results.map((result, index) => (
                      <div
                        key={index}
                        className={`alert ${result.success ? 'alert-success' : 'alert-danger'}`}
                        role="alert"
                      >
                        <div className="d-flex justify-content-between align-items-start mb-2">
                          <div>
                            <span className="badge bg-primary me-2">{result.protocol.toUpperCase()}</span>
                            <span className={`badge ${result.success ? 'bg-success' : 'bg-danger'}`}>
                              {result.success ? '✓ Success' : '✗ Failed'}
                            </span>
                          </div>
                          <small className="text-muted">{result.duration}</small>
                        </div>
                        <small className="d-block font-monospace">{result.message}</small>
                      </div>
                    ))}

                    {tracerouteResult && (
                      <div className="alert alert-secondary" role="alert">
                        <strong>🔍 Traceroute Results</strong>
                        <pre className="mb-0 mt-2 p-3" style={{maxHeight: '400px', overflowY: 'auto', backgroundColor: '#f8f9fa'}}>{tracerouteResult}</pre>
                      </div>
                    )}
                  </div>
                )}

                {testing && (
                  <div className="text-center py-4">
                    <div className="spinner-border mb-3" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                    <p className="text-muted">
                      {currentTest ? (
                        <>Running {currentTest.toUpperCase()} test... (timeout: {timeout}s)</>
                      ) : (
                        <>Preparing tests...</>
                      )}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
