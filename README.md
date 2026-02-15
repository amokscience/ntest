# Network Connectivity Tester

A full-stack application for testing network connectivity to various endpoints using multiple protocols. Built with Go (backend) and React (frontend), runs as a **single executable**.

## Features

- **Multiple Protocol Support**: Test connectivity using:
  - PING (ICMP echo)
  - TCP connections
  - UDP sockets
  - HTTP requests
  - HTTPS requests
  - All protocols at once

- **User-Friendly Interface**: Clean React-based UI with real-time results
- **Real-Time Progress**: Shows which test is currently running (PING, TCP, etc.)
- **Configurable Timeout**: Set custom timeout (1-60 seconds, default: 10)
- **Success Notifications**: Visual notification when all tests complete
- **Detailed Results**: Shows success/failure status, duration, and detailed messages
- **Single Executable**: Frontend embedded in Go binary - no separate servers needed
- **Docker Support**: Optional containerized deployment with docker-compose

## Architecture

```
┌─────────────────────────────────────┐
│     Single Go Executable            │
│  ┌────────────┐   ┌──────────────┐ │
│  │  Frontend  │   │   Backend    │ │
│  │  (Embedded)│   │   (API)      │ │
│  └────────────┘   └──────────────┘ │
│         Port 8080                   │
└─────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Go 1.21 or higher
- Node.js 18+ and npm (for building)
- (Optional) Docker Desktop for containerized deployment

### Running Locally (Single Executable)

1. **Navigate to the project directory**:
   ```powershell
   cd c:\code\ntest
   ```

2. **Build the application** (first time only):
   ```powershell
   .\build.ps1
   ```
   This will:
   - Build the React frontend
   - Embed it into the Go binary
   - Create `network-tester.exe`

3. **Run the application**:
   ```powershell
   .\run.ps1
   ```
   Or run directly:
   ```powershell
   .\network-tester.exe
   ```

4. **Access the application**:
   - Open your browser to: `http://localhost:8080`

That's it! Single executable serves both frontend and backend.

### Running with Docker (Alternative)

1. **Build and start the containers**:
   ```bash
   docker-compose up --build
   ```

2. **Access the application**:
   - Open your browser and navigate to: `http://localhost:3000`
   - The backend API runs on: `http://localhost:8080`

3. **Stop the application**:
   ```bash
   docker-compose down
   ```

## Usage

1. **Enter Target**: Input an IP address (e.g., `8.8.8.8`) or domain name (e.g., `google.com`)
2. **Select Protocol**: Choose from:
   - `All` (default) - runs all tests (skips PING if port is specified)
   - `Ping` - ICMP echo test (port field disabled - ICMP doesn't use ports)
   - `TCP` - TCP connection test
   - `UDP` - UDP socket test
   - `HTTP` - HTTP GET request
   - `HTTPS` - HTTPS GET request
3. **Enter Port** (optional): Specify a port number for TCP, UDP, HTTP, HTTPS tests
   - **Note**: Port field is disabled when PING is selected
   - When "All" is selected with a port, PING is automatically skipped
4. **Set Timeout** (optional): Timeout in seconds (default: 10, max: 60)
5. **Click "Test Connection"**: Results will appear below showing success/failure and details
6. **Completion**: A success notification appears when all tests finish

## API Endpoints

### Health Check
```
GET /health
```
Returns server health status.

### Run Network Test
```
POST /api/test
Content-Type: application/json

{
  "target": "google.com",
  "protocol": "all",
  "port": "443",
  "timeout": 10
}
```

**Response:**
```json
{
  "results": [
    {
      "protocol": "ping",
      "success": true,
      "message": "Ping successful: 4 packets transmitted, 4 received, 0% packet loss",
      "duration": "245.32ms"
    }
  ]
}
```

### Run Network Test (Streaming)
```
POST /api/test/stream
Content-Type: application/json

{
  "target": "google.com",
  "protocol": "all",
  "port": "443",
  "timeout": 10
}
```

**Response:** Server-Sent Events stream with real-time progress

## Important Considerations & Known Issues

### 1. **Ping/ICMP Requirements**

**Issue**: Ping requires special network capabilities in Docker containers.

**Solution**: The `docker-compose.yml` includes:
```yaml
cap_add:
  - NET_RAW
  - NET_ADMIN
```

**Limitations**:
- On some systems, ping may still fail due to security restrictions
- Windows containers have different ping command syntax
- Running with `--privileged` flag may be needed in restricted environments

### 2. **Port Parameter Usage**

**Issue**: Port parameter behavior varies by protocol.

**Details**:
- **PING**: Port parameter is ignored (ICMP doesn't use ports)
- **TCP/UDP**: Port is required (defaults: TCP=80, UDP=53 if not specified)
- **HTTP**: Defaults to port 80 if not specified
- **HTTPS**: Defaults to port 443 if not specified

**Recommendation**: Always specify port for TCP/UDP tests.

### 3. **UDP Testing Limitations**

**Issue**: UDP is connectionless, making true connectivity verification impossible.

**Behavior**:
- The test only verifies that a UDP socket can be created
- It does NOT verify that the remote endpoint is actually listening
- Success doesn't guarantee the target will receive/respond to data

**Message**: Results show:
```
UDP socket created for <target>:<port> 
(Note: UDP is connectionless, actual delivery cannot be verified)
```

### 4. **Timeout Behavior**

**Issue**: Tests timeout after 10 seconds per protocol.

**Implications**:
- When using "All" protocols, total time can be up to 50 seconds (5 protocols × 10s)
- Slow networks may show timeouts even if the target is reachable
- HTTPS handshakes on slow connections may timeout

### 5. **Cross-Origin Resource Sharing (CORS)**

**Issue**: The backend allows all origins (`*`) for development.

**Security Note**: For production, update the CORS configuration in `backend/main.go`:
```go
AllowedOrigins: []string{"http://yourdomain.com"},
```

### 6. **DNS Resolution**

**Issue**: Domain names must resolve successfully before testing.

**Behavior**:
- If DNS resolution fails, all tests will fail
- The error message will indicate DNS failure
- IP addresses bypass DNS resolution

### 7. **Container Network Isolation**

**Issue**: The containers run in their own network namespace.

**Implications**:
- Tests run FROM the container's perspective
- Cannot test `localhost` of the host machine
- To test host services, use `host.docker.internal` (Docker Desktop)

### 8. **HTTP/HTTPS Testing**

**Issue**: Not all servers accept GET requests or may have rate limiting.

**Behavior**:
- Tests send HTTP GET requests
- Some servers may block or throttle requests
- Self-signed HTTPS certificates may cause failures
- 4xx/5xx status codes are shown but marked as successful connections

### 9. **Windows-Specific Considerations**

**Issue**: Ping command differs between Windows and Linux.

**Solution**: The Go code attempts to use Linux-style ping (`-c` flag). The Dockerfile uses Alpine Linux, which uses standard Linux ping.

**Note**: If running the Go backend directly on Windows (not in Docker), the ping function may need modification.

### 10. **Resource Usage**

**Issue**: Running "All" protocols simultaneously uses resources.

**Implications**:
- Multiple goroutines spawn for each test
- High connection count to the target
- May trigger rate limiting or IDS/IPS systems

## Development

### Building from Source

The application is built as a single executable with embedded frontend:

1. **Build everything**:
   ```powershell
   .\build.ps1
   ```

2. **Run the executable**:
   ```powershell
   .\backend\network-tester.exe
   ```

### Development Mode (Hot Reload)

For active development with hot reload:

**Terminal 1 - Backend**:
```powershell
cd backend
go run main.go
```
Backend runs on `http://localhost:8080` (API only mode)

**Terminal 2 - Frontend** (with hot reload):
```powershell
cd frontend
$env:REACT_APP_API_URL="http://localhost:8080"
npm install
npm start
```
Frontend dev server runs on `http://localhost:3000`

**Note**: In development mode, the frontend dev server proxies API calls to the backend.

### Project Structure

```
ntest/
├── backend/
│   ├── main.go           # Go server with embedded frontend
│   ├── go.mod            # Go dependencies
│   ├── Dockerfile        # Backend container config
│   └── frontend/         # Copied frontend build (after build.ps1)
│       └── build/        # Embedded into Go binary
├── frontend/
│   ├── src/
│   │   ├── App.js        # Main React component
│   │   ├── App.css       # Styles
│   │   └── index.js      # Entry point
│   ├── public/
│   │   └── index.html    # HTML template
│   ├── package.json      # Node dependencies
│   ├── Dockerfile        # Frontend container config (for Docker deployment)
│   └── nginx.conf        # Nginx configuration (for Docker deployment)
├── build.ps1            # Build script (creates single executable)
├── run.ps1              # Run script (builds if needed, then runs)
├── docker-compose.yml    # Container orchestration (alternative deployment)
└── README.md            # This file
├── docker-compose.yml    # Container orchestration
└── README.md            # This file
```

## Troubleshooting

### Ping Always Fails
- Ensure Docker has NET_RAW capability
- Try running with: `docker-compose up --privileged`
- Check host firewall settings

### Connection Refused
- Verify target is reachable from your network
- Check if the port is correct and open
- Try with a known-good target like `google.com`

### Frontend Can't Reach Backend
- Ensure both containers are running: `docker ps`
- Check logs: `docker-compose logs backend`
- Verify port 8080 is not used by another application

### Timeout on All Tests
- Check internet connectivity
- Try increasing timeout in `main.go` (currently 10 seconds)
- Verify DNS resolution is working

## Security Considerations

1. **Network Capabilities**: The container runs with NET_RAW capability (required for ping)
2. **CORS**: Currently allows all origins - restrict in production
3. **Rate Limiting**: No rate limiting implemented - add for production use
4. **Input Validation**: Basic validation exists - enhance for production
5. **Logging**: Add audit logging for compliance requirements

## Future Enhancements

- Add traceroute functionality
- Support for concurrent test history
- Export results to JSON/CSV
- Authentication and user management
- Rate limiting and quota management
- Custom timeout configuration
- Packet size configuration for ping
- TLS certificate validation options

## License

This project is provided as-is for educational and testing purposes.

## Support

For issues or questions, please refer to the "Important Considerations & Known Issues" section above.
