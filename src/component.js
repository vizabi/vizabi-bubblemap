import {
  BaseComponent,
  Icons,
  Utils,
  LegacyUtils as utils,
  Labels,
  DynamicBackground
} from "VizabiSharedComponents";

import {decorate, computed, observable, action} from "mobx";

import topojson from "./topojson.js";
import d3GeoProjection from "./d3.geoProjection.js";

const {ICON_QUESTION} = Icons;
const COLOR_WHITEISH = "rgb(253, 253, 253)";

const MAX_RADIUS_EM = 0.05;

const PROFILE_CONSTANTS = (width, height) => ({
  SMALL: {
    margin: { top: 10, right: 10, left: 10, bottom: 0 },
    headerMargin: {top: 10, right: 20, bottom: 20, left: 10},
    infoElHeight: 16,
    infoElMargin: 5,
    minRadiusPx: 0.5,
    maxRadiusPx: Math.max(0.5, MAX_RADIUS_EM * utils.hypotenuse(width, height)),
  },
  MEDIUM: {
    margin: { top: 20, right: 20, left: 20, bottom: 30 },
    headerMargin: {top: 10, right: 20, bottom: 20, left: 15},
    infoElHeight: 20,
    infoElMargin: 5,
    minRadiusPx: 1,
    maxRadiusPx: Math.max(0.5, MAX_RADIUS_EM * utils.hypotenuse(width, height)),
  },
  LARGE: {
    margin: { top: 30, right: 30, left: 30, bottom: 35 },
    headerMargin: {top: 10, right: 20, bottom: 20, left: 20},
    infoElHeight: 22,
    infoElMargin: 5,
    minRadiusPx: 1,
    maxRadiusPx: Math.max(0.5, MAX_RADIUS_EM * utils.hypotenuse(width, height)),
  }
});

const PROFILE_CONSTANTS_FOR_PROJECTOR = () => ({
  MEDIUM: {
    infoElHeight: 26,
    infoElMargin: 10,
  },
  LARGE: {
    infoElHeight: 32,
    infoElMargin: 10,
  }
});

class _VizabiBubblemap extends BaseComponent {

  constructor(config) {

    config.subcomponents = [{
      type: DynamicBackground,
      placeholder: ".vzb-bmc-year"
    },{
      type: Labels,
      placeholder: ".vzb-bmc-labels",      
      options: {
        CSS_PREFIX: "vzb-bmc",
        LABELS_CONTAINER_CLASS: "vzb-bmc-labels",
        LINES_CONTAINER_CLASS: "vzb-bmc-lines",
        SUPPRESS_HIGHLIGHT_DURING_PLAY: false
      },
      name: "labels"
    }];

    config.template = `
      <svg class="vzb-bmc-map-background vzb-export">
          <g class="vzb-bmc-map-graph"></g>
      </svg>
      <svg class="vzb-bubblemap-svg vzb-export">
          <g class="vzb-bmc-graph">
              <g class="vzb-bmc-year"></g>

              <g class="vzb-bmc-bubbles"></g>

              <g class="vzb-bmc-axis-s-title">
                  <text></text>
              </g>

              <g class="vzb-bmc-axis-c-title">
                  <text></text>
              </g>

              <g class="vzb-bmc-axis-s-info vzb-noexport"></g>

              <g class="vzb-bmc-axis-c-info vzb-noexport"></g>

              <g class="vzb-bmc-lines"></g>
              <svg class="vzb-bmc-labels-crop">
              <g class="vzb-bmc-labels"></g>
              </svg>
          </g>
          <rect class="vzb-bmc-forecastoverlay vzb-hidden" x="0" y="0" width="100%" height="100%" fill="url(#vzb-bmc-pattern-lines)" pointer-events='none'></rect>
          <g class="vzb-datawarning-button vzb-noexport"></g>
      </svg>
      <svg>
          <defs>
              <pattern id="vzb-bmc-pattern-lines" x="0" y="0" patternUnits="userSpaceOnUse" width="50" height="50" viewBox="0 0 10 10"> 
                  <path d='M-1,1 l2,-2M0,10 l10,-10M9,11 l2,-2' stroke='black' stroke-width='3' opacity='0.08'/>
              </pattern> 
          </defs>
      </svg>
    `;
    super(config);
  }

  setup() {
    this.DOM = {
      element: this.element,

      graph: this.element.select(".vzb-bmc-graph"),
      mapSvg: this.element.select(".vzb-bmc-map-background"),
      mapGraph: this.element.select(".vzb-bmc-map-graph"),
  
      bubbleContainerCrop: this.element.select(".vzb-bmc-bubbles-crop"),
      bubbleContainer: this.element.select(".vzb-bmc-bubbles"),
      labelListContainer: this.element.select(".vzb-bmc-bubble-labels"),
  
      sTitle: this.element.select(".vzb-bmc-axis-s-title"),
      cTitle: this.element.select(".vzb-bmc-axis-c-title"),
      sInfo: this.element.select(".vzb-bmc-axis-y-info"),
      cInfo: this.element.select(".vzb-bmc-axis-c-info"),
      forecastOverlay: this.element.select(".vzb-bmc-forecastoverlay")
    };

    
    d3GeoProjection();

    // http://bl.ocks.org/mbostock/d4021aa4dccfd65edffd patterson
    // http://bl.ocks.org/mbostock/3710566 robinson
    // map background

    if(!d3[this.ui.map.projection]) return utils.warn(`Projection ${this.ui.map.projection} is not available in d3`);

    // project to bounding box https://bl.ocks.org/mbostock/4707858
    this.projection = d3[this.ui.map.projection]()
      .scale(1)
      .translate([0, 0]);

    //guess map bounds (hardcoded for gapminder bubble map world-50m.json)
    this.mapBounds = [
      [-3.0365722270964945, -1.4899523584310421],
      [3.049764882149918, 1.5707963267948966]
    ];
    this.preload().then(()=>{
      this._initMap();
    });
    this._labels = this.findChild({type: "Labels"});
    this._year = this.findChild({type: "DynamicBackground"});
  }

  get MDL(){
    return {
      frame: this.model.encoding.frame,
      selected: this.model.encoding.selected,
      highlighted: this.model.encoding.highlighted,
      size: this.model.encoding[this.state.alias.size || "size"],
      color: this.model.encoding.color,
      label: this.model.encoding.label
    };
  }

  draw(){
    this.localise = this.services.locale.auto();

    // new scales and axes
    this.sScale = this.MDL.size.scale.d3Scale;
    this.cScale = color => color? this.MDL.color.scale.d3Scale(color) : COLOR_WHITEISH;

    if (this._updateLayoutProfile()) return; //return if exists with error
    
    this.addReaction(this.updateSize);    
    this.addReaction(this._rescaleMap);
    this.addReaction(this._drawHeader);
    this.addReaction(this._updateYear);
    this.addReaction(this._drawData);
    this.addReaction(this._updateOpacity);
    this.addReaction(this._drawForecastOverlay);
  }

  _getDuration() {
    //smooth animation is needed when playing, except for the case when time jumps from end to start
    if(!this.MDL.frame) return 0;
    this.frameValue_1 = this.frameValue;
    this.frameValue = this.MDL.frame.value;
    return this.__duration = this.MDL.frame.playing && (this.frameValue - this.frameValue_1 > 0) ? this.MDL.frame.speed : 0;
  }

  _updateYear() {
    const duration = this._getDuration();
    this._year.setText(this.localise(this.MDL.frame.value), duration);
  }

  _drawForecastOverlay() {
    this.DOM.forecastOverlay.classed("vzb-hidden", 
      !this.ui.showForecast || 
      !this.ui.showForecastOverlay || 
      !this.ui.endBeforeForecast || 
        (this.MDL.frame.value <= this.MDL.frame.parseValue(this.ui.endBeforeForecast))
    );
  }

  _updateLayoutProfile(){
    this.services.layout.size;

    this.height = (this.element.node().clientHeight) || 0;
    this.width = (this.element.node().clientWidth) || 0;

    this.profileConstants = this.services.layout.getProfileConstants(
      PROFILE_CONSTANTS(this.width, this.height), 
      PROFILE_CONSTANTS_FOR_PROJECTOR(this.width, this.height)
    );
    
    if (!this.height || !this.width) return utils.warn("Chart _updateProfile() abort: container is too little or has display:none");

  }


  preload() {
    if (this.topology) return Promise.resolve();

    const reader = this.model.data.source.reader;

    //where the path to preload geoshape can be defined either directly in config:
    const topoPath = utils.getProp(this, ["ui", "map", "topology", "path"]);

    //or via an entity property in dataset, but this functionality was never needed, so i removed the implementation
    //const topoWhich = utils.getProp(this, ["ui", "map", "topology", "which"]);
    //const topoKey = utils.getProp(this, ["ui", "map", "topology", "key"]);

    return new Promise((resolve, reject) => {
      if (topoPath) {
        reader.getAsset(topoPath)
          .then(response => {
            this.topology = response;
            resolve();
          })
          .catch(() => {
            reject(new Error("unable to fetch the map"));
          });
      } else {
        reject(new Error("topoPath is not set"));
      }
    });
  }

  _initMap() {
    if (!this.topology) utils.warn("Bubble map is missing the map data:", this.topology);

    this.projection
      .scale(1)
      .translate([0, 0]);

    this.mapPath = d3.geoPath()
      .projection(this.projection);

    this.DOM.mapGraph.html("");

    this.mapFeature = topojson.feature(this.topology, this.topology.objects[this.ui.map.topology.objects.geo]);
    const boundaries = topojson.mesh(this.topology, this.topology.objects[this.ui.map.topology.objects.boundaries], (a, b) => a !== b);

    this.mapBounds = this.mapPath.bounds(this.mapFeature);

    if (this.mapFeature.features) {
      this.DOM.mapGraph.selectAll(".land")
        .data(this.mapFeature.features)
        .enter().insert("path")
        .attr("d", this.mapPath)
        .attr("id", d => d.properties[this.ui.map.topology.geoIdProperty].toLowerCase())
        .attr("class", "land");
    } else {
      this.DOM.mapGraph.insert("path")
        .datum(this.mapFeature)
        .attr("class", "land");
    }

    this.DOM.mapGraph.insert("path")
      .datum(boundaries)
      .attr("class", "boundary");
  }

  _rescaleMap() {
    this.services.layout.size;

    const offset = this.ui.map.offset;
    const {margin} = this.profileConstants;

    // scale to aspect ratio
    // http://bl.ocks.org/mbostock/4707858
    const s = this.ui.map.scale / Math.max((this.mapBounds[1][0] - this.mapBounds[0][0]) / this.width, (this.mapBounds[1][1] - this.mapBounds[0][1]) / this.height);

    // dimensions of the map itself (regardless of cropping)
    const mapWidth = (s * (this.mapBounds[1][0] - this.mapBounds[0][0]));
    const mapHeight = (s * (this.mapBounds[1][1] - this.mapBounds[0][1]));

    // dimensions of the viewport in which the map is shown (can be bigger or smaller than map)
    let viewPortHeight = mapHeight * (1 + offset.top + offset.bottom);
    let viewPortWidth = mapWidth * (1 + offset.left + offset.right);
    const mapTopOffset = mapHeight * offset.top;
    const mapLeftOffset = mapWidth * offset.left;

    // translate projection to the middle of map
    const t = [(mapWidth - s * (this.mapBounds[1][0] + this.mapBounds[0][0])) / 2, (mapHeight - s * (this.mapBounds[1][1] + this.mapBounds[0][1])) / 2];

    this.projection
      .scale(s)
      .translate(t);

    this.DOM.mapGraph
      .selectAll("path").attr("d", this.mapPath);

    // handle scale to fit case
    let widthScale, heightScale;
    if (!this.ui.map.preserveAspectRatio) {

      // wrap viewBox around viewport so map scales to fit viewport
      const viewBoxHeight = viewPortHeight;
      const viewBoxWidth = viewPortWidth;

      // viewport is complete area (apart from scaling)
      viewPortHeight = this.height * this.ui.map.scale;
      viewPortWidth = this.width * this.ui.map.scale;

      this.DOM.mapSvg
        .attr("preserveAspectRatio", "none")
        .attr("viewBox", [0, 0, viewBoxWidth, viewBoxHeight].join(" "));

      //            ratio between map, viewport and offset (for bubbles)
      widthScale = viewPortWidth / (mapWidth || 1) / (1 + offset.left + offset.right);
      heightScale = viewPortHeight / (mapHeight || 1) / (1 + offset.top + offset.bottom);

    } else {

      // no scaling needed
      widthScale = 1;
      heightScale = 1;

    }

    // internal offset against parent container (mapSvg)
    this.DOM.mapGraph
      .attr("transform", "translate(" + mapLeftOffset + "," + mapTopOffset + ")");

    this.DOM.graph
      .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

    // resize and put in center
    this.DOM.mapSvg
      .style("transform", "translate3d(" + (margin.left + (this.width - viewPortWidth) / 2) + "px," + (margin.top + (this.height - viewPortHeight) / 2) + "px,0)")
      .attr("width", viewPortWidth)
      .attr("height", viewPortHeight);

    // set skew function used for bubbles in chart
    const _this = this;
    this.skew = (function() {
      const w = _this.width;
      const h = _this.height;
      //input pixel loc after projection, return pixel loc after skew;
      return function(points) {
        //      input       scale         translate                    translate offset
        const x = points[0] * widthScale + ((w - viewPortWidth) / 2) + mapLeftOffset * widthScale;
        const y = points[1] * heightScale + ((h - viewPortHeight) / 2) + mapTopOffset * heightScale;
        return [x, y];
      };
    })();


  }

  getValue(d){
    return d;
  }

  _processFrameData() {
    return this.__dataProcessed = this.model.dataArray
      .concat()
      .map(this.getValue);
  }

  _createAndDeleteBubbles() {

    this.bubbles = this.DOM.bubbleContainer.selectAll(".vzb-bmc-bubble")
      .data(this.__dataProcessed, d => d[Symbol.for("key")]);

    //exit selection
    this.bubbles.exit().remove();

    //enter selection -- init circles
    this.bubbles = this.bubbles.enter().append("circle")
      .attr("class", "vzb-bmc-bubble")
      .attr("id", (d) => `vzb-br-bar-${d[Symbol.for("key")]}-${this.id}`)
      .merge(this.bubbles)
      .order();

    if(!utils.isTouchDevice()){
      this.bubbles
        .on("mouseover", this._interact().mouseover)
        .on("mouseout", this._interact().mouseout)
        .on("click", this._interact().click);
    } else {
      this.bubbles
        .onTap((event, d) => {
          event.stopPropagation();
          this._interact().click(event, d);
        });
    }
  }

  _interact() {
    const _this = this;

    return {
      mouseover(event, d) {
        if (_this.MDL.frame.dragging) return;

        _this.hovered = d;
        _this.MDL.highlighted.data.filter.set(d);
        //put the exact value in the size title
        //this.updateTitleNumbers();
        //_this.fitSizeOfTitles();
       
        // if not selected, show tooltip
        if (!_this.MDL.selected.data.filter.has(d)) _this._setTooltip(event, d);
      },
      mouseout(event, d) {
        if (_this.MDL.frame.dragging) return;

        _this.hovered = null;
        _this.MDL.highlighted.data.filter.delete(d);
        //_this.updateTitleNumbers();
        //_this.fitSizeOfTitles();

        _this._setTooltip(event);
        //_this._labels.clearTooltip();
      },
      click(event, d) {
        _this.MDL.highlighted.data.filter.delete(d);
        _this._setTooltip(event);
        //_this._labels.clearTooltip();
        _this.MDL.selected.data.filter.toggle(d);
        //_this.selectToggleMarker(d);
      },
      tap(event, d) {
        _this._setTooltip(event);
        _this.MDL.selected.data.filter.toggle(d);
        //_this.selectToggleMarker(d);
        event.stopPropagation();
      }
    };
  }

  selectToggleMarker(d){
    if(d) this.MDL.selected.data.filter.toggle(d);
  }

  _setTooltip(event, d) {
    if (event && d) {
      const labelValues = {};
      const tooltipCache = {};
      const mouse = d3.pointer(event);
      const x = d.center[0] || mouse[0];
      const y = d.center[1] || mouse[1];
      const offset = d.r || 0;

      labelValues.valueS = d[this._alias("size")];
      labelValues.labelText = this.__labelWithoutFrame(d);
      tooltipCache.labelX0 = labelValues.valueX = x / this.width;
      tooltipCache.labelY0 = labelValues.valueY = y / this.height;
      tooltipCache.scaledS0 = offset;
      tooltipCache.scaledC0 = null;

      this._labels.setTooltip(d, labelValues.labelText, tooltipCache, labelValues);
    } else {
      this._labels.setTooltip();
    }
  }

  __labelWithoutFrame(d) {
    if (typeof d.label == "object") 
      return Object.entries(d.label)
        .filter(entry => entry[0] != this.MDL.frame.data.concept)
        .map(entry => entry[1])
        .join(", ");
    if (d.label != null) return "" + d.label;
    return d[Symbol.for("key")];
  }

  _drawData(duration) {
    this.services.layout.size;
    
    this._processFrameData();
    this._createAndDeleteBubbles();
    this.updateMarkerSizeLimits();

    const _this = this;
    if (!duration) duration = this.__duration;
    if (!this.bubbles) return utils.warn("redrawDataPoints(): no entityBubbles defined. likely a premature call, fix it!");

    this.bubbles.each(function(d) {
      const view = d3.select(this);

      const sValue = d[_this._alias("size")];
      d.hidden = (!sValue && sValue !== 0) || d.lon == null || d.lat == null;

      d.r = utils.areaToRadius(_this.sScale(sValue)||0);
      d.center = _this.skew(_this.projection([d.lon || 0, d.lat || 0]));

      view
        .classed("vzb-hidden", d.hidden)
        .attr("cx", d.center[0])
        .attr("cy", d.center[1]);
        
      if (view.classed("vzb-hidden") !== d.hidden || !duration) {
        view
          .attr("r", d.r)
          .attr("fill", _this.cScale(d.color));
      } else {
        view.transition().duration(duration).ease(d3.easeLinear)
          .attr("r", d.r)
          .attr("fill", _this.cScale(d.color));
      }

      _this._updateLabel(d, duration);
    });

  }


  _updateLabel(d, duration) {
    if (duration == null) duration = this.duration;

    // only for selected entities
    if (this.MDL.selected.data.filter.has(d)) {

      const showhide = d.hidden !== d.hidden_1;
      const valueLST = null;
      const sValue = d[this._alias("size")];
      const cache = {
        labelX0: d.center[0] / this.width,
        labelY0: d.center[1] / this.height,
        scaledS0: sValue ? utils.areaToRadius(this.sScale(sValue)) : null,
        scaledC0: this.cScale(d.color)
      };

      this._labels.updateLabel(d, cache, d.center[0] / this.width, d.center[1] / this.height, sValue, d.color, this.__labelWithoutFrame(d), valueLST, duration, showhide);
    }
  }

  updateSize() {
    this.services.layout.size;

    const {margin} = this.profileConstants;

    this._year.setConditions({ 
      xAlign: "right", 
      yAlign: "top", 
      widthRatio: 2 / 10,
      rightOffset: 30
    });
    this._year.resizeText(this.width, this.height);
    //this.repositionElements();
    //this.rescaleMap();

    this.root.findChild({type: "_DataWarning"}).setOptions({
      width: this.width,
      height: this.height,
      vertical: "bottom", 
      horizontal: this.services.locale.isRTL() ? "left" : "right",
      right: margin.right,
      left: margin.left,
      bottom: margin.bottom
    });
  }

  updateMarkerSizeLimits() {
    //this is very funny
    this.services.layout.size;
    this.MDL.size.scale.domain;

    const {
      minRadiusPx: minRadius,
      maxRadiusPx: maxRadius
    } = this.profileConstants;

    //transfer min max radius to size dialog via root ui observable (probably a cleaner way is possible)
    this.root.ui.minMaxRadius = {min: minRadius, max: maxRadius};
      
    const extent = this.MDL.size.scale.extent || [0, 1];

    let minArea = utils.radiusToArea(Math.max(maxRadius * extent[0], minRadius));
    let maxArea = utils.radiusToArea(Math.max(maxRadius * extent[1], minRadius));

    let range = minArea === maxArea ? [minArea, maxArea] :
      d3.range(minArea, maxArea, (maxArea - minArea) / (this.sScale.domain().length - 1)).concat(maxArea);

    this.sScale.range(range);
  }


  _updateOpacity() {
    this.MDL.frame.value; //listen

    const {
      opacityHighlightDim,
      opacitySelectDim,
      opacityRegular,
    } = this.ui;

    const _highlighted = this.MDL.highlighted.data.filter;
    const _selected = this.MDL.selected.data.filter;
    
    const someHighlighted = _highlighted.markers.size > 0;
    const someSelected = _selected.markers.size > 0;

    this.bubbles
      .style("opacity", d => {
        if (_highlighted.has(d)) return opacityRegular;
        if (_selected.has(d)) return opacityRegular;

        if (someSelected) return opacitySelectDim;
        if (someHighlighted) return opacityHighlightDim;

        return opacityRegular;
      });
  }

  _unselectBubblesWithNoData() {
    //unselecting bubbles with no data is used for the scenario when
    //some bubbles are selected and user would switch indicator.
    //bubbles would disappear but selection would stay
    const _this = this;
    if (this.MDL.selected.markers.size > 0)
      this.bubbles.each((d)=>{
        const sValue = d[_this._alias("size")];
        if (!sValue && sValue !== 0) _this.MDL.selected.delete(d);
      });
  }

  _drawHeader() {
    const {
      headerMargin,
      infoElHeight,
      infoElMargin,
    } = this.profileConstants;

    this.services.layout.size;

    const sText = this.options.sTitle || 
      this.localise("buttons/size") + ": " + (this.MDL.size.data.isConstant ? this.localise("indicator/_default/color") : this.MDL.size.data.conceptProps.name);
    const cText = this.options.cTitle || 
      this.localise("buttons/color") + ": " + (this.MDL.color.data.isConstant ? this.localise("indicator/_default/color") : this.MDL.color.data.conceptProps.name);

    const treemenu = this.root.findChild({type: "TreeMenu"});
    const sTitle = this.DOM.sTitle
      .classed("vzb-disabled", treemenu.state.ownReadiness !== Utils.STATUS.READY)
      .on("click", () => {
        treemenu
          .encoding(this._alias("size"))
          .alignX(this.services.locale.isRTL() ? "right" : "left")
          .alignY("top")
          .updateView()
          .toggle();
      })
      .select("text")
      .text(sText);

    const cTitle = this.DOM.cTitle
      .classed("vzb-disabled", treemenu.state.ownReadiness !== Utils.STATUS.READY)
      .classed("vzb-hidden", this.services.layout.profile == "LARGE")
      .on("click", () => {
        treemenu
          .encoding(this._alias("color"))
          .alignX(this.services.locale.isRTL() ? "right" : "left")
          .alignY("top")
          .updateView()
          .toggle();
      })
      .select("text")
      .text(cText);

    const sTitleBBox = sTitle.node().getBBox();

    const sTitleTx = headerMargin.left;
    const sTitleTy = headerMargin.top + sTitleBBox.height;
    sTitle.attr("transform", `translate(${sTitleTx}, ${sTitleTy})`);
    
    const sInfoTx = sTitleTx + sTitleBBox.width + infoElMargin;
    const sInfoTy = headerMargin.top + infoElHeight / 4;
    this.DOM.sInfo.attr("transform", `translate(${sInfoTx}, ${sInfoTy})`);
    this._drawInfoEl(this.DOM.sInfo, sTitle, this.MDL.size);


    const cTitleBBox = cTitle.node().getBBox();

    const cTitleTx = headerMargin.left;
    const cTitleTy = sTitleTy + cTitleBBox.height + infoElMargin;
    cTitle.attr("transform", `translate(${cTitleTx}, ${cTitleTy})`);
    
    const cInfoTx = cTitleTx + cTitleBBox.width + infoElMargin;
    const cInfoTy = sTitleTy + infoElHeight / 4 + infoElMargin;
    this.DOM.cInfo.attr("transform", `translate(${cInfoTx}, ${cInfoTy})`)
      .classed("vzb-hidden", this.services.layout.profile == "LARGE");
    this._drawInfoEl(this.DOM.cInfo, cTitle, this.MDL.color);


  }

  _drawInfoEl(element, titleElement, model){
    const dataNotes = this.root.findChild({type: "DataNotes"});
    const conceptProps = model.data.conceptProps;
    const infoElHeight = this.profileConstants.infoElHeight;

    element
      .on("click", () => {
        dataNotes.pin();
      })
      .on("mouseover", function() {
        const rect = this.getBBox();
        const ctx = utils.makeAbsoluteContext(this, this.farthestViewportElement);
        const coord = ctx(rect.x - 10, rect.y + rect.height + 10);
        dataNotes
          .setEncoding(model)
          .show()
          .setPos(coord.x, coord.y);
      })
      .on("mouseout", () => {
        dataNotes.hide();
      })
      .html(ICON_QUESTION)
      .select("svg")
      .attr("width", infoElHeight + "px").attr("height", infoElHeight + "px")
      .classed("vzb-hidden", 
        model.data.isConstant || !conceptProps.description && !conceptProps.sourceLink || titleElement.classed("vzb-hidden")
      );
  }

  _alias(enc) {
    return this.state.alias[enc] || enc;
  }

}




_VizabiBubblemap.DEFAULT_UI = {
  showForecast: false,
  showForecastOverlay: true,
  pauseBeforeForecast: true,
  opacityHighlight: 1.0,
  opacitySelect: 1.0,
  opacityHighlightDim: 0.1,
  opacitySelectDim: 0.3,
  opacityRegular: 0.5,
  datawarning: {
    doubtDomain: [],
    doubtRange: []
  },
  labels: {
    enabled: true,
    dragging: true,
    removeLabelBox: false
  },
  superhighlightOnMinimapHover: true,
  map: {
    path: null,
    colorGeo: false,
    preserveAspectRatio: false,
    scale: 1.1,
    offset: {
      top: 0.05,
      right: 0,
      bottom: -0.2,
      left: -0.15
    },
    projection: "geo" + "Aitoff",
    topology: {
      path: "assets/world-50m.json",
      objects: {
        geo: "land",
        boundaries: "countries"
      },
      geoIdProperty: null,
    }
  }
};


//export default BubbleChart;
export const VizabiBubblemap = decorate(_VizabiBubblemap, {
  "MDL": computed,
  "mapBounds": observable,
  "skew": observable,
  "_initMap": action
});
