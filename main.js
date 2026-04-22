const canvas = document.getElementById("glcanvas");
const gl = canvas.getContext("webgl2");

if (!gl) {
    alert("WebGL2 not supported");
}

let sceneFbo = null;
let sceneColorTex = null;
let sceneDepthRb = null;

const bloomCheckbox = document.getElementById("toggleBloom");
let bloomEnabled = bloomCheckbox ? bloomCheckbox.checked : false;
const vignetteCheckbox = document.getElementById("toggleVignette");
let vignetteEnabled = vignetteCheckbox ? vignetteCheckbox.checked : false;

if (bloomCheckbox) {
    bloomCheckbox.addEventListener("change", (event) => {
        bloomEnabled = event.target.checked;
    });
}

if (vignetteCheckbox) {
    vignetteCheckbox.addEventListener("change", (event) => {
        vignetteEnabled = event.target.checked;
    });
}

function resizeCanvas() {
    canvas.height = window.innerHeight;
    canvas.width = window.innerWidth;
    gl.viewport(0, 0, canvas.width, canvas.height);
    resizeRenderTargets();
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

let anglex = 0
let angley = 0
let anglez = 0
let scalex = 1
let scaley = 1
let scalez = 1
let tx = 0
let ty = 0
let tz = 0

function createTransformMatrix(
    angleX = 0,
    angleY = 0,
    angleZ = 0,
    scalex = 1,
    scaley = 1,
    scalez = 1,
    tx = 0,
    ty = 0,
    tz = 0
) {

    const cx = Math.cos(angleX);
    const sx = Math.sin(angleX);

    const cy = Math.cos(angleY);
    const sy = Math.sin(angleY);

    const cz = Math.cos(angleZ);
    const sz = Math.sin(angleZ);

    // Rotation X
    const rx = new Float32Array([
        1, 0, 0, 0,
        0, cx, sx, 0,
        0, -sx, cx, 0,
        0, 0, 0, 1
    ]);

    // Rotation Y
    const ry = new Float32Array([
        cy, 0, -sy, 0,
        0, 1, 0, 0,
        sy, 0, cy, 0,
        0, 0, 0, 1
    ]);

    // Rotation Z
    const rz = new Float32Array([
        cz, sz, 0, 0,
        -sz, cz, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
    ]);

    // Scale
    const s = new Float32Array([
        scalex, 0, 0, 0,
        0, scaley, 0, 0,
        0, 0, scalez, 0,
        0, 0, 0, 1
    ]);

    function multiply(a, b) {
        const out = new Float32Array(16);

        for (let col = 0; col < 4; col++) {
            for (let row = 0; row < 4; row++) {
                out[col * 4 + row] =
                    a[0 * 4 + row] * b[col * 4 + 0] +
                    a[1 * 4 + row] * b[col * 4 + 1] +
                    a[2 * 4 + row] * b[col * 4 + 2] +
                    a[3 * 4 + row] * b[col * 4 + 3];
            }
        }

        return out;
    }

    // R = Rz * Ry * Rx
    const rxy = multiply(ry, rx);
    const rxyz = multiply(rz, rxy);

    // RS = R * S
    const rs = multiply(rxyz, s);

    rs[12] = tx;
    rs[13] = ty;
    rs[14] = tz;
    rs[15] = 1;

    return rs;
}

function createPerspectiveMatrix(fov, aspect, near, far) {
    const f = 1.0 / Math.tan(fov / 2);
    const nf = 1 / (near - far);

    return new Float32Array([
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (far + near) * nf, -1,
        0, 0, (2 * far * near) * nf, 0
    ]);
}

// ШЕЙДЕРЫ
// Кубы
const vsSource = `#version 300 es
in vec3 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat4 uModel;
uniform mat4 uProjection;

void main() {
    gl_Position = uProjection * uModel * vec4(aPosition, 1.0);
    vUV = aUV;
}
`;

const fsSource = `#version 300 es
precision mediump float;

in vec2 vUV;

uniform sampler2D uTextureMat;

out vec4 outColor;

void main() {
    outColor = texture(uTextureMat, vUV);
}
`;

const postVsSource = `#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;

void main() {
    vUV = aUV;
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const postFsSource = `#version 300 es
precision highp float;

in vec2 vUV;

uniform sampler2D uSceneTex;
uniform vec2 uTexelSize;
uniform float uBloomStrength;
uniform float uVignetteStrength;

out vec4 outColor;

vec3 extractBright(vec2 uv) {
    vec3 c = texture(uSceneTex, uv).rgb;
    float luminance = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float mask = smoothstep(0.62, 1.0, luminance);
    return c * mask;
}

void main() {
    vec3 base = texture(uSceneTex, vUV).rgb;
    vec2 o1 = uTexelSize * 1.5;
    vec2 o2 = uTexelSize * 3.0;

    vec3 bloom = extractBright(vUV) * 0.24;
    bloom += (extractBright(vUV + vec2(o1.x, 0.0)) + extractBright(vUV - vec2(o1.x, 0.0))) * 0.15;
    bloom += (extractBright(vUV + vec2(0.0, o1.y)) + extractBright(vUV - vec2(0.0, o1.y))) * 0.15;
    bloom += (extractBright(vUV + o2) + extractBright(vUV - o2)) * 0.08;
    bloom += (extractBright(vUV + vec2(-o2.x, o2.y)) + extractBright(vUV + vec2(o2.x, -o2.y))) * 0.08;

    vec3 color = base + bloom * uBloomStrength;

    vec2 centeredUv = vUV * 2.0 - 1.0;
    float dist = length(centeredUv);
    float vignette = 1.0 - smoothstep(0.45, 1.12, dist);
    color *= mix(1.0, vignette, uVignetteStrength);

    outColor = vec4(color, 1.0);
}
`;

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
    }

    return shader;
}

const vertexShader = createShader(gl, gl.VERTEX_SHADER, vsSource);
const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fsSource);

const program = gl.createProgram();
gl.attachShader(program, vertexShader);
gl.attachShader(program, fragmentShader);
gl.linkProgram(program);

if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
}

gl.useProgram(program);

const textureLoc = gl.getUniformLocation(program, "uTextureMat");

const postVertexShader = createShader(gl, gl.VERTEX_SHADER, postVsSource);
const postFragmentShader = createShader(gl, gl.FRAGMENT_SHADER, postFsSource);

const postProgram = gl.createProgram();
gl.attachShader(postProgram, postVertexShader);
gl.attachShader(postProgram, postFragmentShader);
gl.linkProgram(postProgram);

if (!gl.getProgramParameter(postProgram, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(postProgram));
}

const postSceneTexLoc = gl.getUniformLocation(postProgram, "uSceneTex");
const postTexelSizeLoc = gl.getUniformLocation(postProgram, "uTexelSize");
const postBloomStrengthLoc = gl.getUniformLocation(postProgram, "uBloomStrength");
const postVignetteStrengthLoc = gl.getUniformLocation(postProgram, "uVignetteStrength");

const postQuad = new Float32Array([
    -1, -1, 0, 0,
     1, -1, 1, 0,
    -1,  1, 0, 1,
    -1,  1, 0, 1,
     1, -1, 1, 0,
     1,  1, 1, 1
]);

const postVao = gl.createVertexArray();
gl.bindVertexArray(postVao);

const postVbo = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, postVbo);
gl.bufferData(gl.ARRAY_BUFFER, postQuad, gl.STATIC_DRAW);

const postPosLoc = gl.getAttribLocation(postProgram, "aPosition");
const postUvLoc = gl.getAttribLocation(postProgram, "aUV");

gl.enableVertexAttribArray(postPosLoc);
gl.vertexAttribPointer(postPosLoc, 2, gl.FLOAT, false, 4 * 4, 0);

gl.enableVertexAttribArray(postUvLoc);
gl.vertexAttribPointer(postUvLoc, 2, gl.FLOAT, false, 4 * 4, 2 * 4);

gl.bindVertexArray(null);

function resizeRenderTargets() {
    if (sceneColorTex) {
        gl.deleteTexture(sceneColorTex);
    }
    if (sceneDepthRb) {
        gl.deleteRenderbuffer(sceneDepthRb);
    }
    if (sceneFbo) {
        gl.deleteFramebuffer(sceneFbo);
    }

    sceneColorTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, sceneColorTex);
    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        canvas.width,
        canvas.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    sceneDepthRb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, sceneDepthRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, canvas.width, canvas.height);

    sceneFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneColorTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, sceneDepthRb);

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        console.error("Bloom framebuffer is incomplete");
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
}

resizeRenderTargets();

// КУБЫ

const vertices = new Float32Array([
    // Задняя грань
  -0.5,-0.5, 0.5,   1,0,0,   0,0,
   0.5,-0.5, 0.5,   0,1,0,   1,0,
   0.5, 0.5, 0.5,   0,0,1,   1,1,
  -0.5, 0.5, 0.5,   1,1,0,   0,1,

  // Передняя грань
  -0.5,-0.5,-0.5,   1,0,1,   0,0,
   0.5,-0.5,-0.5,   0,1,1,   1,0,
   0.5, 0.5,-0.5,   1,1,1,   1,1,
  -0.5, 0.5,-0.5,   0,0,0,   0,1,

  // Левая грань
  -0.5,-0.5,-0.5,   1,0,0,   0,0,
  -0.5,-0.5, 0.5,   1,0,0,   1,0,
  -0.5, 0.5, 0.5,   1,0,0,   1,1,
  -0.5, 0.5,-0.5,   1,0,0,   0,1,

  // Правая грань
   0.5,-0.5,-0.5,   0,1,0,   0,0,
   0.5,-0.5, 0.5,   0,1,0,   1,0,
   0.5, 0.5, 0.5,   0,1,0,   1,1,
   0.5, 0.5,-0.5,   0,1,0,   0,1,

  // Верхняя грань
  -0.5, 0.5, 0.5,   0,0,1,   0,0,
   0.5, 0.5, 0.5,   0,0,1,   1,0,
   0.5, 0.5,-0.5,   0,0,1,   1,1,
  -0.5, 0.5,-0.5,   0,0,1,   0,1,

  // Нижняя грань
  -0.5,-0.5,-0.5,   1,1,0,   0,0,
   0.5,-0.5,-0.5,   1,1,0,   1,0,
   0.5,-0.5, 0.5,   1,1,0,   1,1,
  -0.5,-0.5, 0.5,   1,1,0,   0,1
]);

const indices = new Uint16Array([
  0,1,2, 0,2,3,
  4,5,6, 4,6,7,
  8,9,10, 8,10,11,
  12,13,14, 12,14,15,
  16,17,18, 16,18,19,
  20,21,22, 20,22,23
]);

const vao = gl.createVertexArray();
gl.bindVertexArray(vao);

const vbo = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

const ebo = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

const posLoc = gl.getAttribLocation(program, "aPosition");
const uvLoc = gl.getAttribLocation(program, "aUV");

gl.enableVertexAttribArray(posLoc);
gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 8 * 4, 0);

gl.enableVertexAttribArray(uvLoc);
gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 8 * 4, 6 * 4);

gl.bindVertexArray(null);

const modelLoc = gl.getUniformLocation(program, "uModel");
const projectionLoc = gl.getUniformLocation(program, "uProjection");

gl.enable(gl.DEPTH_TEST);

// ТЕКСТУРЫ

function loadTexture(src) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

    const img = new Image();
    img.src = src;

    img.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            img
        );
    };

    return texture;
}

const textureMat = [];

textureMat.push(loadTexture("textures/gold.jpg"));
textureMat.push(loadTexture("textures/copper.jpg"));
textureMat.push(loadTexture("textures/tree.jpg"));

const models = [];

async function loadOBJ(url) {
    const resp = await fetch(url);
    const text = await resp.text();
    const lines = text.split('\n');
    
    const positions = [];
    const texcoords = [];
    const vertices = [];
    
    for (let line of lines) {
        line = line.trim();
        if (line.startsWith('v ')) {
            const parts = line.split(/\s+/);
            positions.push(
                parseFloat(parts[1]),
                parseFloat(parts[2]),
                parseFloat(parts[3])
            );
        } else if (line.startsWith('vt ')) {
            const parts = line.split(/\s+/);
            texcoords.push(
                parseFloat(parts[1]),
                1.0 - parseFloat(parts[2])
            );
        } else if (line.startsWith('f ')) {
            const parts = line.split(/\s+/);
            const faceIndices = [];
            for (let i = 1; i < parts.length; i++) {
                const indices = parts[i].split('/');
                const posIdx = parseInt(indices[0]) - 1;
                const texIdx = indices[1] ? parseInt(indices[1]) - 1 : null;
                faceIndices.push({ posIdx, texIdx });
            }
            for (let i = 1; i < faceIndices.length - 1; i++) {
                const a = faceIndices[0];
                const b = faceIndices[i];
                const c = faceIndices[i + 1];
                [a, b, c].forEach(idx => {
                    const px = positions[idx.posIdx * 3];
                    const py = positions[idx.posIdx * 3 + 1];
                    const pz = positions[idx.posIdx * 3 + 2];
                    let u = 0, v = 0;
                    if (idx.texIdx !== null && texcoords.length) {
                        u = texcoords[idx.texIdx * 2];
                        v = texcoords[idx.texIdx * 2 + 1];
                    }
                    vertices.push(px, py, pz, u, v);
                });
            }
        }
    }
    
    return {
        vertices: new Float32Array(vertices),
        count: vertices.length / 5
    };
}

async function loadModel(name, posX, posY, scale) {
    const objUrl = `models/${name}.obj`;
    const texUrl = `models/${name}.png`;
    
    try {
        const objData = await loadOBJ(objUrl);
        const texture = loadTexture(texUrl);
        
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        
        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, objData.vertices, gl.STATIC_DRAW);
        
        const posLoc = gl.getAttribLocation(program, "aPosition");
        const uvLoc = gl.getAttribLocation(program, "aUV");
        
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 5 * 4, 0);
        gl.enableVertexAttribArray(uvLoc);
        gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 5 * 4, 3 * 4);
        
        gl.bindVertexArray(null);
        
        models.push({
            vao,
            count: objData.count,
            texture,
            posX,
            posY,
            scale
        });
        
        console.log(`Модель ${name} загружена`);
    } catch (e) {
        console.error(`Ошибка загрузки ${name}:`, e);
    }
}

loadModel('bananaCat', 0, 0.07, 0.5);
loadModel('Sherlock', 1, 0.25, 2);
loadModel('GrumpyCat', -1, 0.25, 1);

function renderCube(num, tx) {
    const aspect = canvas.width / canvas.height;

    const projection = createPerspectiveMatrix(
        Math.PI / 4,  // 45
        aspect,
        0.1,
        100
    );

    const model = createTransformMatrix(
        anglex,
        angley,
        anglez,
        scalex * 0.5,
        scaley * 0.5,
        scalez * 0.5,
        tx, -0.5, -4
    );

    gl.uniformMatrix4fv(modelLoc, false, model);
    gl.uniformMatrix4fv(projectionLoc, false, projection);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textureMat[num]);
    gl.uniform1i(textureLoc, 0);

    gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
}

// РЕНДЕР

function drawScene() {
    gl.useProgram(program);
    renderCube(0, 0);
    renderCube(1, -1);
    renderCube(2, 1);

    if (models.length > 0) {
        const aspect = canvas.width / canvas.height;
        const projection = createPerspectiveMatrix(Math.PI / 4, aspect, 0.1, 100);

        models.forEach(model => {
            const modelMatrix = createTransformMatrix(
                0, angley, 0,
                model.scale, model.scale, model.scale,
                model.posX, model.posY, -4
            );

            gl.uniformMatrix4fv(modelLoc, false, modelMatrix);
            gl.uniformMatrix4fv(projectionLoc, false, projection);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, model.texture);
            gl.uniform1i(textureLoc, 0);

            gl.bindVertexArray(model.vao);
            gl.drawArrays(gl.TRIANGLES, 0, model.count);
        });
    }
}

function render() {
    if (bloomEnabled || vignetteEnabled) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0.96, 0.92, 0.99, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        drawScene();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0.96, 0.92, 0.99, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.disable(gl.DEPTH_TEST);
        gl.useProgram(postProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sceneColorTex);
        gl.uniform1i(postSceneTexLoc, 0);
        gl.uniform2f(postTexelSizeLoc, 1 / canvas.width, 1 / canvas.height);
        gl.uniform1f(postBloomStrengthLoc, bloomEnabled ? 0.85 : 0.0);
        gl.uniform1f(postVignetteStrengthLoc, vignetteEnabled ? 1.0 : 0.0);

        gl.bindVertexArray(postVao);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindVertexArray(null);
        gl.enable(gl.DEPTH_TEST);
    } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0.96, 0.92, 0.99, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        drawScene();
    }
    
    anglex += 0.01;
    angley += 0.01;
    anglez += 0.01;
    
    requestAnimationFrame(render);
}

render();