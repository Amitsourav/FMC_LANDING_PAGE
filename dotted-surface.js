(function () {
  const container = document.getElementById('dotted-surface');
  if (!container) return;

  const SEPARATION = 150;
  const AMOUNTX = 40;
  const AMOUNTY = 60;

  // Teal color (#0D9488) normalized to 0-1 range
  const TEAL_R = 13 / 255;
  const TEAL_G = 148 / 255;
  const TEAL_B = 136 / 255;

  // Mouse tracking
  let mouseX = 0;
  let mouseY = 0;
  let targetMouseX = 0;
  let targetMouseY = 0;

  // Scene setup
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffffff, 2000, 10000);

  const camera = new THREE.PerspectiveCamera(
    60,
    container.offsetWidth / container.offsetHeight,
    1,
    10000
  );
  camera.position.set(0, 355, 1220);

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.offsetWidth, container.offsetHeight);
  renderer.setClearColor(0x000000, 0);

  container.appendChild(renderer.domElement);

  // Create particle geometry
  const positions = [];
  const colors = [];

  const geometry = new THREE.BufferGeometry();

  for (let ix = 0; ix < AMOUNTX; ix++) {
    for (let iy = 0; iy < AMOUNTY; iy++) {
      const x = ix * SEPARATION - (AMOUNTX * SEPARATION) / 2;
      const y = 0;
      const z = iy * SEPARATION - (AMOUNTY * SEPARATION) / 2;

      positions.push(x, y, z);
      colors.push(TEAL_R, TEAL_G, TEAL_B);
    }
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  // Material with teal dots
  const material = new THREE.PointsMaterial({
    size: 8,
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geometry, material);
  scene.add(points);

  let count = 0;

  // Mouse move listener
  document.addEventListener('mousemove', function (e) {
    targetMouseX = (e.clientX - window.innerWidth / 2) * 0.5;
    targetMouseY = (e.clientY - window.innerHeight / 2) * 0.3;
  });

  // Animation loop
  function animate() {
    requestAnimationFrame(animate);

    // Smooth mouse follow
    mouseX += (targetMouseX - mouseX) * 0.05;
    mouseY += (targetMouseY - mouseY) * 0.05;

    const posAttr = geometry.attributes.position;
    const arr = posAttr.array;

    let i = 0;
    for (let ix = 0; ix < AMOUNTX; ix++) {
      for (let iy = 0; iy < AMOUNTY; iy++) {
        const index = i * 3;
        arr[index + 1] =
          Math.sin((ix + count) * 0.3) * 50 +
          Math.sin((iy + count) * 0.5) * 50;
        i++;
      }
    }

    posAttr.needsUpdate = true;

    // Camera follows cursor
    camera.position.x += (mouseX - camera.position.x) * 0.03;
    camera.position.y += (-mouseY + 355 - camera.position.y) * 0.03;
    camera.lookAt(scene.position);

    renderer.render(scene, camera);

    // Very slow wave speed
    count += 0.015;
  }

  // Resize handler
  function handleResize() {
    camera.aspect = container.offsetWidth / container.offsetHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.offsetWidth, container.offsetHeight);
  }

  window.addEventListener('resize', handleResize);
  animate();
})();
