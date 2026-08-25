(() => {
  const canvas = document.querySelector('.pattern-background');
  if (!canvas) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const maxTouches = 6;
  const touches = [];
  const color = [0.58, 0.60, 0.64];

  const vertexShaderSource = `#version 300 es
    in vec2 aPosition;
    void main() {
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const fragmentShaderSource = `#version 300 es
    precision highp float;

    uniform vec3 uColor;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uPixelSize;
    uniform float uScale;
    uniform float uDensity;
    uniform vec2 uClickPos[6];
    uniform float uClickTimes[6];

    out vec4 fragColor;

    float bayer2(vec2 p) {
      p = floor(p);
      return fract(p.x / 2.0 + p.y * p.y * 0.75);
    }

    float bayer4(vec2 p) { return bayer2(p) * 0.25 + bayer2(p * 0.5); }
    float bayer8(vec2 p) { return bayer4(p) * 0.25 + bayer2(p); }

    float hash11(float n) {
      return fract(sin(n) * 43758.5453);
    }

    float valueNoise(vec3 p) {
      vec3 ip = floor(p);
      vec3 fp = fract(p);
      vec3 w = fp * fp * fp * (fp * (fp * 6.0 - 15.0) + 10.0);
      float n000 = hash11(dot(ip + vec3(0.0, 0.0, 0.0), vec3(1.0, 57.0, 113.0)));
      float n100 = hash11(dot(ip + vec3(1.0, 0.0, 0.0), vec3(1.0, 57.0, 113.0)));
      float n010 = hash11(dot(ip + vec3(0.0, 1.0, 0.0), vec3(1.0, 57.0, 113.0)));
      float n110 = hash11(dot(ip + vec3(1.0, 1.0, 0.0), vec3(1.0, 57.0, 113.0)));
      float n001 = hash11(dot(ip + vec3(0.0, 0.0, 1.0), vec3(1.0, 57.0, 113.0)));
      float n101 = hash11(dot(ip + vec3(1.0, 0.0, 1.0), vec3(1.0, 57.0, 113.0)));
      float n011 = hash11(dot(ip + vec3(0.0, 1.0, 1.0), vec3(1.0, 57.0, 113.0)));
      float n111 = hash11(dot(ip + vec3(1.0, 1.0, 1.0), vec3(1.0, 57.0, 113.0)));
      float x00 = mix(n000, n100, w.x);
      float x10 = mix(n010, n110, w.x);
      float x01 = mix(n001, n101, w.x);
      float x11 = mix(n011, n111, w.x);
      return mix(mix(x00, x10, w.y), mix(x01, x11, w.y), w.z) * 2.0 - 1.0;
    }

    float fbm(vec2 uv, float time) {
      vec3 p = vec3(uv * uScale, time);
      float amplitude = 1.0;
      float frequency = 1.0;
      float sum = 1.0;
      for (int i = 0; i < 5; i++) {
        sum += amplitude * valueNoise(p * frequency);
        frequency *= 1.25;
        amplitude *= 1.0;
      }
      return sum * 0.5 + 0.5;
    }

    void main() {
      float pixelSize = uPixelSize;
      vec2 fragCoord = gl_FragCoord.xy - uResolution * 0.5;
      float aspectRatio = uResolution.x / uResolution.y;
      vec2 pixelId = floor(fragCoord / pixelSize);
      vec2 pixelUv = fract(fragCoord / pixelSize);
      float cellPixelSize = 8.0 * pixelSize;
      vec2 cellId = floor(fragCoord / cellPixelSize);
      vec2 cellCoord = cellId * cellPixelSize;
      vec2 uv = cellCoord / uResolution * vec2(aspectRatio, 1.0);

      float base = fbm(uv, uTime * 0.05) * 0.5 - 0.65;
      float feed = base + 0.15;

      for (int i = 0; i < 6; i++) {
        if (uClickPos[i].x < 0.0) continue;
        float elapsed = max(uTime - uClickTimes[i], 0.0);
        vec2 clickUv = ((uClickPos[i] - uResolution * 0.5) / uResolution) * vec2(aspectRatio, 1.0);
        float distanceToClick = distance(uv, clickUv);
        float waveRadius = 0.3 * elapsed;
        float ring = exp(-pow((distanceToClick - waveRadius) / 0.1, 2.0));
        float attenuation = exp(-elapsed) * exp(-10.0 * distanceToClick);
        feed = max(feed, ring * attenuation);
      }

      float dither = bayer8(fragCoord / uPixelSize) - 0.5;
      float pixelsOn = step(0.5, feed + dither);
      float hash = fract(sin(dot(pixelId, vec2(127.1, 311.7))) * 43758.5453);
      float coverage = pixelsOn * (1.0 + (hash - 0.5) * 0.08);
      float distanceToCenter = distance(pixelUv, vec2(0.5));
      float circleEdge = 0.42;
      float circleAa = fwidth(distanceToCenter);
      float circleMask = 1.0 - smoothstep(circleEdge - circleAa, circleEdge + circleAa, distanceToCenter);

      float edge = min(min(gl_FragCoord.x, gl_FragCoord.y), min(uResolution.x - gl_FragCoord.x, uResolution.y - gl_FragCoord.y));
      float edgeFade = smoothstep(0.0, min(uResolution.x, uResolution.y) * 0.42, edge);
      float alpha = coverage * circleMask * edgeFade;

      fragColor = vec4(uColor, alpha);
    }
  `;

  const compileShader = (gl, type, source) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const rememberTouch = (event, now) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    touches.unshift({
      x: event.clientX * dpr,
      y: (window.innerHeight - event.clientY) * dpr,
      time: now,
    });
    touches.length = Math.min(touches.length, maxTouches);
  };

  const setupWebGL = () => {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      powerPreference: 'high-performance',
    });
    if (!gl) return false;

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    if (!vertexShader || !fragmentShader) return false;

    const program = gl.createProgram();
    if (!program) return false;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;

    const buffer = gl.createBuffer();
    if (!buffer) return false;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    gl.useProgram(program);
    const position = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uniforms = {
      color: gl.getUniformLocation(program, 'uColor'),
      resolution: gl.getUniformLocation(program, 'uResolution'),
      time: gl.getUniformLocation(program, 'uTime'),
      pixelSize: gl.getUniformLocation(program, 'uPixelSize'),
      scale: gl.getUniformLocation(program, 'uScale'),
      density: gl.getUniformLocation(program, 'uDensity'),
      clickPos: gl.getUniformLocation(program, 'uClickPos[0]'),
      clickTimes: gl.getUniformLocation(program, 'uClickTimes[0]'),
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.floor(window.innerWidth * dpr));
      const height = Math.max(1, Math.floor(window.innerHeight * dpr));
      if (canvas.width === width && canvas.height === height) return;
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(document.documentElement);
    const start = performance.now();
    let frame = 0;

    const render = (now) => {
      const time = (now - start) * 0.0005;
      const clickPositions = new Float32Array(maxTouches * 2).fill(-1);
      const clickTimes = new Float32Array(maxTouches).fill(-1000);
      for (let i = 0; i < touches.length; i++) {
        clickPositions[i * 2] = touches[i].x;
        clickPositions[i * 2 + 1] = touches[i].y;
        clickTimes[i] = touches[i].time;
      }

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform3fv(uniforms.color, color);
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      gl.uniform1f(uniforms.time, time);
      gl.uniform1f(uniforms.pixelSize, 4.0 * Math.min(window.devicePixelRatio || 1, 2));
      gl.uniform1f(uniforms.scale, 2.2);
      gl.uniform1f(uniforms.density, 1.0);
      gl.uniform2fv(uniforms.clickPos, clickPositions);
      gl.uniform1fv(uniforms.clickTimes, clickTimes);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      if (!reducedMotion) frame = requestAnimationFrame(render);
    };

    window.addEventListener('pointerdown', (event) => rememberTouch(event, (performance.now() - start) * 0.0005), { passive: true });
    render(performance.now());

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  };

  const setupFallback = () => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let frame = 0;
    const start = performance.now();

    const render = (now) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = window.innerWidth;
      const height = window.innerHeight;
      const pixelWidth = Math.max(1, Math.floor(width * dpr));
      const pixelHeight = Math.max(1, Math.floor(height * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const time = (now - start) * 0.0003;
      const cell = 9;
      ctx.fillStyle = `rgb(${color[0] * 255}, ${color[1] * 255}, ${color[2] * 255})`;
      for (let y = 0; y < height; y += cell) {
        for (let x = 0; x < width; x += cell) {
          const wave = Math.sin(x * 0.018 + time) + Math.cos(y * 0.015 - time * 0.8);
          const alpha = Math.max(0, (wave - 0.6) * 0.14) * Math.min(x, y, width - x, height - y) / 120;
          if (alpha <= 0) continue;
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.arc(x + 2, y + 2, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      if (!reducedMotion) frame = requestAnimationFrame(render);
    };

    render(performance.now());
    return () => cancelAnimationFrame(frame);
  };

  const cleanup = setupWebGL() || setupFallback();
  window.addEventListener('pagehide', () => cleanup?.(), { once: true });
})();
