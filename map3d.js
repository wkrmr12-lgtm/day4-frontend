// ───────── 3D 지도 (three.js) ─────────
// 실제 고도(AWS Terrarium 타일) + 위성 사진(Esri) 지형 위에 시·도별 날씨 라벨과 PM2.5 기둥을 표시합니다. (API 키 불필요)
const Map3D = (() => {
  const Z = 7, X0 = 108, Y0 = 49, N = 3;            // z7 타일 3×3 (위도 약 32.0°~38.7°, 경도 약 124.7°~132.2°)
  const SIZE = 100, H_SCALE = 0.0009;               // 장면 크기 / 고도 과장(1000m ≈ 0.9) — 지형이 보이도록 약 6배 과장
  const COLORS = ["#2f9bff","#2fbf71","#f2a33a","#e5484d","#999999"];
  const TILES = 2 ** Z;
  let built = false, building = false, active = false;
  let renderer, scene, camera, controls, terrain, heights, W, group, selMesh, raf;
  let lastPlace = null, tTarget = null;
  const $ = id => document.getElementById(id);

  // 위경도 ↔ 장면 좌표 (웹 메르카토르)
  const lonToTx = lon => (lon + 180) / 360 * TILES;
  const latToTy = lat => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * TILES; };
  const toScene = (lat, lon) => ({ x: ((lonToTx(lon) - X0) / N - .5) * SIZE, z: ((latToTy(lat) - Y0) / N - .5) * SIZE });
  const fromScene = (x, z) => {
    const tx = (x / SIZE + .5) * N + X0, ty = (z / SIZE + .5) * N + Y0;
    return { lon: tx / TILES * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / TILES))) * 180 / Math.PI };
  };
  const hAt = (x, z) => {
    const px = Math.min(W - 1, Math.max(0, Math.round((x / SIZE + .5) * (W - 1))));
    const py = Math.min(W - 1, Math.max(0, Math.round((z / SIZE + .5) * (W - 1))));
    return Math.max(heights[py * W + px], 0) * H_SCALE;
  };

  const loadImg = url => new Promise(res => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });

  async function buildTerrain(msg){
    // 1) 고도 타일 → 높이 배열
    W = 256 * N;
    const ec = document.createElement("canvas"); ec.width = ec.height = W;
    const ex = ec.getContext("2d", { willReadFrequently: true });
    const eTiles = [];
    for(let dy=0; dy<N; dy++) for(let dx=0; dx<N; dx++)
      eTiles.push(loadImg(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${X0+dx}/${Y0+dy}.png`).then(i => ({ i, dx, dy })));
    let okE = 0;
    for(const t of await Promise.all(eTiles)) if(t.i){ ex.drawImage(t.i, t.dx*256, t.dy*256); okE++; }
    if(!okE) throw new Error("고도 데이터를 불러오지 못했습니다");
    const d = ex.getImageData(0, 0, W, W).data;
    heights = new Float32Array(W * W);
    for(let i=0; i<W*W; i++) heights[i] = d[i*4] * 256 + d[i*4+1] + d[i*4+2] / 256 - 32768;

    // 2) 위성 타일(z8) → 텍스처
    msg("위성 지도 불러오는 중…");
    const S = N * 2, tc = document.createElement("canvas"); tc.width = tc.height = S * 256;
    const tx = tc.getContext("2d"); tx.fillStyle = "#1d3a5a"; tx.fillRect(0, 0, tc.width, tc.height);
    const sTiles = [];
    for(let dy=0; dy<S; dy++) for(let dx=0; dx<S; dx++)
      sTiles.push(loadImg(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z+1}/${Y0*2+dy}/${X0*2+dx}`).then(i => ({ i, dx, dy })));
    for(const t of await Promise.all(sTiles)) if(t.i) tx.drawImage(t.i, t.dx*256, t.dy*256);
    const tex = new THREE.CanvasTexture(tc);
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();

    // 3) 지형 메쉬
    const segs = 383, geo = new THREE.PlaneGeometry(SIZE, SIZE, segs, segs);
    geo.rotateX(-Math.PI / 2);                       // 위쪽(+y) = 북쪽(-z)
    const pos = geo.attributes.position;
    for(let r=0; r<=segs; r++) for(let c=0; c<=segs; c++){
      const px = Math.round(c / segs * (W - 1)), py = Math.round(r / segs * (W - 1));
      pos.setY(r * (segs + 1) + c, Math.max(heights[py * W + px], 0) * H_SCALE);
    }
    geo.computeVertexNormals();
    terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
    scene.add(terrain);
  }

  // 라벨 스프라이트
  function labelSprite(o){
    const c = document.createElement("canvas"); c.width = 320; c.height = 120;
    const x = c.getContext("2d"), col = COLORS[o.g < 0 ? 4 : o.g];
    x.fillStyle = "rgba(255,255,255,.95)"; x.strokeStyle = col; x.lineWidth = 8;
    x.beginPath(); x.roundRect ? x.roundRect(6, 6, 308, 108, 22) : x.rect(6, 6, 308, 108); x.fill(); x.stroke();
    x.fillStyle = "#222"; x.textAlign = "center"; x.textBaseline = "middle";
    x.font = "bold 40px -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
    x.fillText(`${o.short} ${o.icon} ${o.temp}°`, 160, 42);
    x.font = "30px -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif"; x.fillStyle = col;
    x.fillText(`PM2.5 ${o.pm != null ? Math.round(o.pm) : "-"}`, 160, 86);
    const t = new THREE.CanvasTexture(c);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    s.scale.set(11, 4.1, 1); s.renderOrder = 10;
    return s;
  }

  function setData(){
    if(!built) return;
    while(group.children.length){ const o = group.children.pop(); o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); }
    (window.overviewData || []).forEach(o => {
      const { x, z } = toScene(o.latitude, o.longitude), base = hAt(x, z);
      const h = 1 + (o.pm || 0) * 0.07;                              // 기둥 높이 = PM2.5
      const col = new THREE.Mesh(new THREE.CylinderGeometry(.9, .9, h, 20),
        new THREE.MeshLambertMaterial({ color: COLORS[o.g < 0 ? 4 : o.g] }));
      col.position.set(x, base + h / 2, z);
      const place = { name: o.full, latitude: o.latitude, longitude: o.longitude };
      col.userData.place = place; group.add(col);
      const sp = labelSprite(o); sp.position.set(x, base + h + 2.8, z); sp.userData.place = place; group.add(sp);
    });
  }

  function focus(place){
    lastPlace = place;
    if(!built) return;
    const { x, z } = toScene(place.latitude, place.longitude), y = hAt(x, z);
    selMesh.visible = true; selMesh.position.set(x, y + 1.6, z);
    tTarget = new THREE.Vector3(x, y, z);
  }

  function frame(){
    raf = requestAnimationFrame(frame);
    if(tTarget){
      const delta = tTarget.clone().sub(controls.target).multiplyScalar(.08);
      controls.target.add(delta); camera.position.add(delta);
      if(delta.length() < .01) tTarget = null;
    }
    if(selMesh) selMesh.rotation.y += .03;
    controls.update(); renderer.render(scene, camera);
  }

  function resize(){
    const el = $("map3d"); if(!renderer || !el.clientWidth) return;
    renderer.setSize(el.clientWidth, el.clientHeight); camera.aspect = el.clientWidth / el.clientHeight; camera.updateProjectionMatrix();
  }

  function onClick(ev){
    const r = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2((ev.clientX - r.left) / r.width * 2 - 1, -((ev.clientY - r.top) / r.height * 2 - 1));
    const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, camera);
    const hits = rc.intersectObjects([...group.children, terrain], false);
    if(!hits.length) return;
    const h = hits.find(k => k.object.userData.place) || hits[0];
    if(h.object.userData.place){ input.value = h.object.userData.place.name; load(h.object.userData.place); return; }
    const { lat, lon } = fromScene(h.point.x, h.point.z);
    if(lat > 38.62 || lat < 32.9 || lon < 124.5 || lon > 131.95){ setStatus("대한민국 지역을 선택해 주세요", true); return; }
    input.value = ""; load({ name: nameFor(lat, lon), latitude: lat, longitude: lon });
  }

  async function init(){
    if(built || building) return; building = true;
    const el = $("map3d"), msg = t => { $("map3dMsg").textContent = t; $("map3dMsg").hidden = !t; };
    try{
      if(!window.THREE) throw new Error("three.js를 불러오지 못했습니다");
      msg("지형 불러오는 중…");
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      el.appendChild(renderer.domElement);
      scene = new THREE.Scene(); scene.background = new THREE.Color(0x0e2238);
      camera = new THREE.PerspectiveCamera(45, 1, .1, 500);
      camera.position.set(-2, 95, 36);
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.target.set(-2, 0, -6); controls.enableDamping = true; controls.dampingFactor = .08;
      controls.maxPolarAngle = Math.PI * .47; controls.minDistance = 8; controls.maxDistance = 130;
      scene.add(new THREE.AmbientLight(0xffffff, .78));
      const sun = new THREE.DirectionalLight(0xffffff, .85); sun.position.set(-40, 80, 50); scene.add(sun);
      group = new THREE.Group(); scene.add(group);
      selMesh = new THREE.Mesh(new THREE.ConeGeometry(.9, 2.6, 4), new THREE.MeshBasicMaterial({ color: 0xff4d6d }));
      selMesh.rotation.x = Math.PI; selMesh.visible = false; scene.add(selMesh);
      resize(); new ResizeObserver(resize).observe(el);
      await buildTerrain(msg);
      built = true; setData(); if(lastPlace) focus(lastPlace);
      let down = null;
      renderer.domElement.addEventListener("pointerdown", e => down = [e.clientX, e.clientY]);
      renderer.domElement.addEventListener("pointerup", e => { if(down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) onClick(e); down = null; });
      msg("");
      if(active && !raf) frame();
    }catch(e){
      console.warn("3D 지도 실패:", e); msg("");
      setStatus("3D 지도를 표시할 수 없습니다 (" + (e.message || "WebGL 미지원") + ")", true);
      show(false);
    }finally{ building = false; }
  }

  function show(on){
    active = on;
    $("map").hidden = on; $("map3d").hidden = !on;
    $("btn2d").classList.toggle("on", !on); $("btn3d").classList.toggle("on", on);
    $("legendNote").textContent = on ? "기둥 높이·색 = 초미세먼지(PM2.5) · 드래그 회전, 휠 확대" : "테두리 색 = 초미세먼지(PM2.5)";
    if(on){ init(); resize(); if(built && !raf) frame(); }
    else { if(raf){ cancelAnimationFrame(raf); raf = 0; } map.invalidateSize(); }
  }

  $("btn2d").addEventListener("click", () => show(false));
  $("btn3d").addEventListener("click", () => show(true));
  return { focus, setData };
})();
