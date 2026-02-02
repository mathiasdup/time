// =============================================
// Arrow Targeting System - WebGL 3D Arrow
// =============================================
// Hearthstone-style targeting arrow with animated
// blocks flowing along a bezier curve.
// Ported from standalone prototype.

const ArrowTargeting = (function() {
    let canvas = null;
    let gl = null;
    let program = null;

    // Shader locations
    let aPosition, aNormal;
    let uModelMatrix, uProjectionMatrix, uNormalMatrix;
    let uColorFront, uColorBack, uOpacity;

    // Geometry buffers
    let blockGeom, arrowheadGeom, sphereGeom;

    // Arrow state
    const MAX_BLOCKS = 4;
    const segments = [];

    let active = false;
    let startPos = { x: 0, y: 0 };
    let endPos = { x: 0, y: 0 };
    let time = 0;
    let activationTime = 0;
    let currentCurveOffset = 0;
    let arrowheadState = { visible: false, alpha: 0, x: 0, y: 0, rotation: 0 };
    let originState = { visible: false, alpha: 0, x: 0, y: 0 };
    let tipPos = { x: 0, y: 0 };
    let tiltTarget = false;
    let currentTilt = 0;
    let globalVisibility = 0;

    let animFrameId = null;
    let lastTime = 0;
    let initialized = false;

    // ========== SHADERS ==========
    const vertexShaderSource = `
        attribute vec3 aPosition;
        attribute vec3 aNormal;
        uniform mat4 uModelMatrix;
        uniform mat4 uProjectionMatrix;
        uniform mat3 uNormalMatrix;
        varying vec3 vNormal;
        void main() {
            vNormal = uNormalMatrix * aNormal;
            gl_Position = uProjectionMatrix * uModelMatrix * vec4(aPosition, 1.0);
        }
    `;

    const fragmentShaderSource = `
        precision mediump float;
        varying vec3 vNormal;
        uniform vec3 uColorFront;
        uniform vec3 uColorBack;
        uniform float uOpacity;
        void main() {
            vec3 normal = normalize(vNormal);
            float facing = normal.z;
            vec3 baseColor = facing < 0.0 ? uColorFront : uColorBack;
            gl_FragColor = vec4(baseColor * uOpacity, uOpacity);
        }
    `;

    // ========== WEBGL UTILITIES ==========
    function createShader(type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        return shader;
    }

    function createProgram(vs, fs) {
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        return prog;
    }

    // ========== MATRIX UTILITIES ==========
    function createMat4() {
        return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
    }

    function ortho(left, right, bottom, top, near, far) {
        const m = createMat4();
        m[0] = 2 / (right - left);
        m[5] = 2 / (top - bottom);
        m[10] = -2 / (far - near);
        m[12] = -(right + left) / (right - left);
        m[13] = -(top + bottom) / (top - bottom);
        m[14] = -(far + near) / (far - near);
        return m;
    }

    function multiplyMat4(a, b) {
        const result = new Float32Array(16);
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                result[i * 4 + j] =
                    a[0 * 4 + j] * b[i * 4 + 0] +
                    a[1 * 4 + j] * b[i * 4 + 1] +
                    a[2 * 4 + j] * b[i * 4 + 2] +
                    a[3 * 4 + j] * b[i * 4 + 3];
            }
        }
        return result;
    }

    function translateMat4(x, y, z) {
        const m = createMat4();
        m[12] = x; m[13] = y; m[14] = z;
        return m;
    }

    function rotateZMat4(angle) {
        const c = Math.cos(angle), s = Math.sin(angle);
        const m = createMat4();
        m[0] = c; m[1] = s;
        m[4] = -s; m[5] = c;
        return m;
    }

    function rotateYMat4(angle) {
        const c = Math.cos(angle), s = Math.sin(angle);
        const m = createMat4();
        m[0] = c; m[2] = -s;
        m[8] = s; m[10] = c;
        return m;
    }

    function getNormalMatrix(m) {
        return new Float32Array([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]);
    }

    // ========== GEOMETRY CREATION ==========
    function createBlockGeometry() {
        const w = 56, h = 38, d = 8;
        const tipDepth = 12;

        const shape = [
            [-w/2, -h/2], [w/2 - tipDepth, -h/2], [w/2, 0], [w/2 - tipDepth, h/2], [-w/2, h/2]
        ];

        const vertices = [];
        const normals = [];
        const fz = d/2, bz = -d/2;

        // Front face
        for (let i = 0; i < 3; i++) {
            const i0 = 0, i1 = i + 1, i2 = i + 2;
            vertices.push(shape[i0][0], shape[i0][1], fz, shape[i1][0], shape[i1][1], fz, shape[i2][0], shape[i2][1], fz);
            normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
        }

        // Back face
        for (let i = 0; i < 3; i++) {
            const i0 = 0, i1 = i + 2, i2 = i + 1;
            vertices.push(shape[i0][0], shape[i0][1], bz, shape[i1][0], shape[i1][1], bz, shape[i2][0], shape[i2][1], bz);
            normals.push(0, 0, -1, 0, 0, -1, 0, 0, -1);
        }

        // Sides
        for (let i = 0; i < 5; i++) {
            const p1 = shape[i], p2 = shape[(i + 1) % 5];
            const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
            const len = Math.hypot(dx, dy);
            const nx = dy / len, ny = -dx / len;

            vertices.push(p1[0], p1[1], fz, p2[0], p2[1], fz, p2[0], p2[1], bz);
            vertices.push(p1[0], p1[1], fz, p2[0], p2[1], bz, p1[0], p1[1], bz);
            for (let j = 0; j < 6; j++) normals.push(nx, ny, 0);
        }

        return createGLBuffer(vertices, normals);
    }

    function createArrowheadGeometry() {
        const baseW = 17, tipLen = 63, h = 40, d = 9;
        const notchDepth = 12;

        // Origin at TIP: offset all x-coordinates by -tipLen
        const shape = [
            [-baseW - tipLen, -h/2], [baseW - tipLen, -h/2], [0, 0], [baseW - tipLen, h/2], [-baseW - tipLen, h/2], [-baseW + notchDepth - tipLen, 0]
        ];

        const vertices = [];
        const normals = [];
        const fz = d/2, bz = -d/2;

        // Front face triangles
        const frontTris = [[0,1,2], [0,2,3], [0,3,5], [3,4,5]];
        for (const [i0, i1, i2] of frontTris) {
            vertices.push(shape[i0][0], shape[i0][1], fz, shape[i1][0], shape[i1][1], fz, shape[i2][0], shape[i2][1], fz);
            normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
        }

        // Back face triangles
        for (const [i0, i1, i2] of frontTris) {
            vertices.push(shape[i0][0], shape[i0][1], bz, shape[i2][0], shape[i2][1], bz, shape[i1][0], shape[i1][1], bz);
            normals.push(0, 0, -1, 0, 0, -1, 0, 0, -1);
        }

        // Sides
        for (let i = 0; i < 6; i++) {
            const p1 = shape[i], p2 = shape[(i + 1) % 6];
            const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
            const len = Math.hypot(dx, dy);
            const nx = dy / len, ny = -dx / len;

            vertices.push(p1[0], p1[1], fz, p2[0], p2[1], fz, p2[0], p2[1], bz);
            vertices.push(p1[0], p1[1], fz, p2[0], p2[1], bz, p1[0], p1[1], bz);
            for (let j = 0; j < 6; j++) normals.push(nx, ny, 0);
        }

        return createGLBuffer(vertices, normals);
    }

    function createSphereGeometry(radius, segs) {
        const vertices = [], normals = [];

        for (let lat = 0; lat < segs; lat++) {
            const t1 = (lat / segs) * Math.PI;
            const t2 = ((lat + 1) / segs) * Math.PI;

            for (let lon = 0; lon < segs; lon++) {
                const p1 = (lon / segs) * 2 * Math.PI;
                const p2 = ((lon + 1) / segs) * 2 * Math.PI;

                const v1 = [radius * Math.sin(t1) * Math.cos(p1), radius * Math.cos(t1), radius * Math.sin(t1) * Math.sin(p1)];
                const v2 = [radius * Math.sin(t1) * Math.cos(p2), radius * Math.cos(t1), radius * Math.sin(t1) * Math.sin(p2)];
                const v3 = [radius * Math.sin(t2) * Math.cos(p2), radius * Math.cos(t2), radius * Math.sin(t2) * Math.sin(p2)];
                const v4 = [radius * Math.sin(t2) * Math.cos(p1), radius * Math.cos(t2), radius * Math.sin(t2) * Math.sin(p1)];

                vertices.push(...v1, ...v2, ...v3, ...v1, ...v3, ...v4);

                const n1 = normalizeVec(v1), n2 = normalizeVec(v2), n3 = normalizeVec(v3), n4 = normalizeVec(v4);
                normals.push(...n1, ...n2, ...n3, ...n1, ...n3, ...n4);
            }
        }

        return createGLBuffer(vertices, normals);
    }

    function normalizeVec(v) {
        const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
        return [v[0]/len, v[1]/len, v[2]/len];
    }

    function createGLBuffer(vertices, normals) {
        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

        const normalBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);

        return { position: positionBuffer, normal: normalBuffer, vertexCount: vertices.length / 3 };
    }

    // ========== BEZIER ==========
    function getControlPoint(p0, p2) {
        const dx = p2.x - p0.x;
        const dy = p2.y - p0.y;
        const dist = Math.hypot(dx, dy);

        let targetOffset;
        if (Math.abs(dx) < 20) {
            targetOffset = -0.5;
        } else {
            targetOffset = dx > 0 ? -1 : 1;
        }

        currentCurveOffset += (targetOffset - currentCurveOffset) * 0.06;

        const curveStrength = Math.max(50, Math.min(140, dist * 0.4));

        const midX = (p0.x + p2.x) / 2;
        const midY = (p0.y + p2.y) / 2;

        const length = Math.max(dist, 1);
        const perpX = -dy / length;
        const perpY = dx / length;

        return {
            x: midX + perpX * curveStrength * currentCurveOffset,
            y: midY + perpY * curveStrength * currentCurveOffset
        };
    }

    const bezier = (t, p0, p1, p2) => ({
        x: (1-t)**2 * p0.x + 2*(1-t)*t * p1.x + t**2 * p2.x,
        y: (1-t)**2 * p0.y + 2*(1-t)*t * p1.y + t**2 * p2.y
    });

    const bezierAngle = (t, p0, p1, p2) => {
        const dx = 2*(1-t)*(p1.x - p0.x) + 2*t*(p2.x - p1.x);
        const dy = 2*(1-t)*(p1.y - p0.y) + 2*t*(p2.y - p1.y);
        return Math.atan2(dy, dx);
    };

    const getCurveLength = (p0, p1, p2) => {
        let length = 0, prev = p0;
        for (let i = 1; i <= 20; i++) {
            const pt = bezier(i / 20, p0, p1, p2);
            length += Math.hypot(pt.x - prev.x, pt.y - prev.y);
            prev = pt;
        }
        return length;
    };

    const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
    const smoothStep = t => t * t * (3 - 2 * t);

    // ========== UPDATE ==========
    function update(delta) {
        time += delta * 0.016;

        // Tilt animation
        const targetTiltVal = tiltTarget ? 1 : 0;
        currentTilt += (targetTiltVal - currentTilt) * 0.12;

        if (!active) {
            currentCurveOffset *= 0.9;

            segments.forEach(seg => {
                seg.currentVisibility *= 0.85;
                if (seg.alpha > 0.01) {
                    seg.alpha *= 0.85;
                } else {
                    seg.visible = false;
                    seg.currentVisibility = 0;
                }
            });

            if (arrowheadState.alpha > 0.01) {
                arrowheadState.alpha *= 0.85;
            } else {
                arrowheadState.visible = false;
            }

            if (originState.alpha > 0.01) {
                originState.alpha *= 0.85;
            } else {
                originState.visible = false;
            }

            return;
        }

        const elapsed = time - activationTime;
        const p0 = startPos;

        // Minimum distance before showing arrow
        const minDistance = 80;
        const distance = Math.hypot(endPos.x - p0.x, endPos.y - p0.y);
        const isGoingUp = endPos.y < p0.y;

        // Smooth global visibility fade
        const targetVis = (distance >= minDistance && isGoingUp) ? 1 : 0;
        const visFadeSpeed = targetVis > globalVisibility ? 0.15 : 0.08;
        globalVisibility += (targetVis - globalVisibility) * visFadeSpeed;

        if (globalVisibility < 0.01) {
            globalVisibility = 0;
            segments.forEach(seg => { seg.visible = false; seg.alpha = 0; });
            arrowheadState.visible = false;
            arrowheadState.alpha = 0;
            originState.visible = false;
            originState.alpha = 0;
            return;
        }

        // Dynamic arrowhead end position on curve
        // When arrowhead tilts, its back appears closer in 2D projection
        const arrowheadLength = 80;
        const currentTiltAngle = currentTilt * Math.PI * 0.35;
        const effectiveArrowLength = arrowheadLength * Math.cos(currentTiltAngle);

        const p2 = endPos;
        const p1 = getControlPoint(p0, p2);
        const curveLength = getCurveLength(p0, p1, p2);
        const tEnd = Math.max(0.3, 1 - (effectiveArrowLength / curveLength));
        const blockEndPos = bezier(tEnd, p0, p1, p2);

        // Arrowhead angle from blockEndPos to mouse
        const headAngle = Math.atan2(p2.y - blockEndPos.y, p2.x - blockEndPos.x);

        // Arrowhead - positioned at mouse (tip is at geometry origin)
        arrowheadState.x = p2.x;
        arrowheadState.y = p2.y;
        arrowheadState.rotation = headAngle;
        arrowheadState.visible = true;

        // Block placement logic
        const BLOCK_WIDTH = 56;
        const MIN_GAP = 25;
        const BLOCK_SPACING = BLOCK_WIDTH + MIN_GAP;
        const tStart = 0.15;
        const tRange = tEnd - tStart;
        const availableLength = curveLength * tRange;
        const maxBlocksForSpace = Math.floor(availableLength / BLOCK_SPACING);
        const numBlocks = Math.min(MAX_BLOCKS, Math.max(0, maxBlocksForSpace));

        const speed = 0.4;
        const loopTime = (time * speed) % 1;

        for (let i = 0; i < MAX_BLOCKS; i++) {
            const seg = segments[i];

            const segTargetVis = i < numBlocks ? 1 : 0;
            const fadeSpeed = 0.08;
            seg.currentVisibility += (segTargetVis - seg.currentVisibility) * fadeSpeed;

            if (seg.currentVisibility < 0.01) {
                seg.visible = false;
                continue;
            }

            const activeBlocks = Math.max(1, numBlocks);
            const phase = (loopTime + i / activeBlocks) % 1;
            const t = tStart + phase * tRange;

            const pt = bezier(t, p0, p1, p2);
            const angle = bezierAngle(t, p0, p1, p2);

            seg.x = pt.x;
            seg.y = pt.y;
            seg.rotation = angle;
            seg.normalizedT = phase;
            seg.visible = true;

            const fadeInZone = 0.18;
            const fadeOutZone = 0.15;

            let alpha = 1;

            if (phase < fadeInZone) {
                alpha = smoothStep(phase / fadeInZone);
            } else if (phase > (1 - fadeOutZone)) {
                alpha = smoothStep((1 - phase) / fadeOutZone);
            }

            const globalAppear = Math.min(1, elapsed * 3);
            alpha *= globalAppear;
            alpha *= seg.currentVisibility;
            alpha *= globalVisibility;

            seg.alpha = alpha;
        }

        // Arrowhead alpha
        const headAppear = Math.min(1, elapsed * 4);
        arrowheadState.alpha = easeOutCubic(headAppear) * globalVisibility;

        // Tip position = mouse position (since arrowhead origin IS the tip)
        tipPos.x = p2.x;
        tipPos.y = p2.y;

        // Origin
        originState.x = p0.x;
        originState.y = p0.y;
        originState.visible = true;
        const originAppear = Math.min(1, elapsed * 5);
        originState.alpha = originAppear * globalVisibility;
    }

    // ========== RENDER ==========
    function drawMesh(geom, x, y, rotationZ, tiltAngle, colorFront, colorBack, opacity) {
        const glX = x - window.innerWidth / 2;
        const glY = -(y - window.innerHeight / 2);

        let model = multiplyMat4(translateMat4(glX, glY, 0), rotateZMat4(-rotationZ));
        model = multiplyMat4(model, rotateYMat4(tiltAngle));

        gl.uniformMatrix4fv(uModelMatrix, false, model);
        gl.uniformMatrix3fv(uNormalMatrix, false, getNormalMatrix(model));
        gl.uniform3fv(uColorFront, colorFront);
        gl.uniform3fv(uColorBack, colorBack);
        gl.uniform1f(uOpacity, opacity);

        gl.bindBuffer(gl.ARRAY_BUFFER, geom.position);
        gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(aPosition);

        gl.bindBuffer(gl.ARRAY_BUFFER, geom.normal);
        gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(aNormal);

        gl.drawArrays(gl.TRIANGLES, 0, geom.vertexCount);
    }

    function render() {
        gl.clear(gl.COLOR_BUFFER_BIT);

        const w = window.innerWidth;
        const h = window.innerHeight;

        const projectionMatrix = ortho(-w/2, w/2, -h/2, h/2, -1000, 1000);
        gl.uniformMatrix4fv(uProjectionMatrix, false, projectionMatrix);

        const colorFront = [0.75, 0.12, 0.06];
        const colorBack = [0.5, 0.1, 0.1];
        const maxTiltAngle = currentTilt * Math.PI * 0.35;
        const transparency = 0.5;

        // Origin sphere (no tilt)
        if (originState.visible && originState.alpha > 0.01) {
            drawMesh(sphereGeom, originState.x, originState.y, 0, 0, colorFront, colorBack, originState.alpha * transparency);
        }

        // Blocks with bell curve tilt: near card tilts backward, middle straight, near arrow tilts forward
        for (const seg of segments) {
            if (seg.visible && seg.alpha > 0.01) {
                const tiltFactor = (seg.normalizedT - 0.5) * 2;
                const progressiveTilt = maxTiltAngle * tiltFactor;
                drawMesh(blockGeom, seg.x, seg.y, seg.rotation, progressiveTilt, colorFront, colorBack, seg.alpha * transparency);
            }
        }

        // Arrowhead with full tilt
        if (arrowheadState.visible && arrowheadState.alpha > 0.01) {
            drawMesh(arrowheadGeom, arrowheadState.x, arrowheadState.y, arrowheadState.rotation, maxTiltAngle, colorFront, colorBack, arrowheadState.alpha * transparency);
        }
    }

    // ========== ANIMATION LOOP ==========
    function animationLoop(currentTime) {
        const delta = lastTime ? (currentTime - lastTime) / 16.67 : 1;
        lastTime = currentTime;

        update(delta);
        render();

        animFrameId = requestAnimationFrame(animationLoop);
    }

    // ========== CANVAS RESIZE ==========
    function resizeCanvas() {
        if (!canvas) return;
        canvas.width = window.innerWidth * window.devicePixelRatio;
        canvas.height = window.innerHeight * window.devicePixelRatio;
        canvas.style.width = window.innerWidth + 'px';
        canvas.style.height = window.innerHeight + 'px';
        if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
    }

    // ========== PUBLIC API ==========
    return {
        init() {
            if (initialized) return true;

            canvas = document.getElementById('gl-canvas');
            if (!canvas) return false;

            gl = canvas.getContext('webgl', { alpha: true, antialias: true });
            if (!gl) return false;

            resizeCanvas();
            window.addEventListener('resize', resizeCanvas);

            // Compile shaders
            const vs = createShader(gl.VERTEX_SHADER, vertexShaderSource);
            const fs = createShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
            program = createProgram(vs, fs);

            // Get locations
            aPosition = gl.getAttribLocation(program, 'aPosition');
            aNormal = gl.getAttribLocation(program, 'aNormal');
            uModelMatrix = gl.getUniformLocation(program, 'uModelMatrix');
            uProjectionMatrix = gl.getUniformLocation(program, 'uProjectionMatrix');
            uNormalMatrix = gl.getUniformLocation(program, 'uNormalMatrix');
            uColorFront = gl.getUniformLocation(program, 'uColorFront');
            uColorBack = gl.getUniformLocation(program, 'uColorBack');
            uOpacity = gl.getUniformLocation(program, 'uOpacity');

            // Create geometry
            blockGeom = createBlockGeometry();
            arrowheadGeom = createArrowheadGeometry();
            sphereGeom = createSphereGeometry(7, 12);

            // Init segments
            for (let i = 0; i < MAX_BLOCKS; i++) {
                segments.push({ visible: false, alpha: 0, currentVisibility: 0, x: 0, y: 0, rotation: 0, normalizedT: 0 });
            }

            // WebGL state
            gl.disable(gl.DEPTH_TEST);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            gl.clearColor(0, 0, 0, 0);
            gl.useProgram(program);

            // Start animation loop
            animFrameId = requestAnimationFrame(animationLoop);

            initialized = true;
            return true;
        },

        activate(x, y) {
            startPos = { x, y };
            endPos = { x, y };
            activationTime = time;
            active = true;
            tiltTarget = false;
            currentTilt = 0;
            globalVisibility = 0;
            segments.forEach(seg => seg.currentVisibility = 0);
        },

        updateEnd(x, y) {
            endPos = { x, y };
        },

        deactivate() {
            active = false;
            tiltTarget = false;
        },

        setTiltTarget(val) {
            tiltTarget = !!val;
        },

        getTipPos() {
            return { x: tipPos.x, y: tipPos.y };
        },

        isActive() {
            return active;
        },

        destroy() {
            if (animFrameId) {
                cancelAnimationFrame(animFrameId);
                animFrameId = null;
            }
            window.removeEventListener('resize', resizeCanvas);
            initialized = false;
        }
    };
})();

window.ArrowTargeting = ArrowTargeting;
