var layer = new Konva.Layer();
var resourceLayer = new Konva.Layer();
var tooltip;
var stage;
var selectedResource;

var canvasWidth, canvasHeight;

const robotWidthMM = 100 + 30 * 22.5; // mm, just the deck
const robotHeightMM = 653.5; // mm
var scaleX, scaleY;

const numRails = 30;

var resources = {}; // name -> Resource object

let trash;

function getSnappingResourceAndLocationAndSnappingBox(resourceToSnap, x, y) {
  // Return the snapping resource that the given point is within, or undefined if there is no such resource.
  // A snapping resource is a spot within a plate/tip carrier or the OT deck.
  // This can probably be simplified a lot.
  // Returns {resource, location wrt resource}

  if (!snappingEnabled) {
    return undefined;
  }

  // Check if the resource is in the trash.
  if (
    x > trash.x() &&
    x < trash.x() + trash.width() &&
    y > trash.y() &&
    y < trash.y() + trash.height()
  ) {
    return {
      resource: trash,
      location: { x: 0, y: 0 },
      snappingBox: {
        x: trash.x(),
        y: trash.y(),
        width: trash.width(),
        height: trash.height(),
      },
    };
  }

  // Check if the resource is in a CarrierSite.
  let deck = resources["deck"];
  for (let resource_name in deck.children) {
    const resource = deck.children[resource_name];

    // Check if we have a resource to snap
    let canSnapPlate =
      resourceToSnap.constructor.name === "Plate" &&
      resource.constructor.name === "PlateCarrier";
    let canSnapTipRack =
      resourceToSnap.constructor.name === "TipRack" &&
      resource.constructor.name === "TipCarrier";
    if (!(canSnapPlate || canSnapTipRack)) {
      continue;
    }

    for (let carrier_site_name in resource.children) {
      let carrier_site = resource.children[carrier_site_name];
      const { x: resourceX, y: resourceY } = carrier_site.getAbsoluteLocation();
      if (
        x > resourceX &&
        x < resourceX + carrier_site.size_x &&
        y > resourceY &&
        y < resourceY + carrier_site.size_y
      ) {
        return {
          resource: carrier_site,
          location: { x: 0, y: 0 },
          snappingBox: {
            x: resourceX,
            y: resourceY,
            width: carrier_site.size_x,
            height: carrier_site.size_y,
          },
        };
      }
    }
  }

  // Check if the resource is in the OT Deck.
  if (deck.constructor.name === "OTDeck") {
    const siteWidth = 128.0;
    const siteHeight = 86.0;

    for (let i = 0; i < otDeckSiteLocations.length; i++) {
      let siteLocation = otDeckSiteLocations[i];
      if (
        x > deck.location.x + siteLocation.x &&
        x < deck.location.x + siteLocation.x + siteWidth &&
        y > deck.location.y + siteLocation.y &&
        y < deck.location.y + siteLocation.y + siteHeight
      ) {
        return {
          resource: deck,
          location: { x: siteLocation.x, y: siteLocation.y },
          snappingBox: {
            x: deck.location.x + siteLocation.x,
            y: deck.location.y + siteLocation.y,
            width: siteWidth,
            height: siteHeight,
          },
        };
      }
    }
  }

  // Check if the resource is in an OTDeck.
  return undefined;
}

function getSnappingGrid(x, y, width, height) {
  // Get the snapping lines for the given resource (defined by x, y, width, height).
  // Returns {resourceX, resourceY, snapX, snapY} where resourceX and resourceY are the
  // location where the resource should be snapped to, and snapX and snapY are the
  // snapping lines that should be drawn.

  if (!snappingEnabled) {
    return {};
  }

  const SNAP_MARGIN = 5;

  let snappingLines = {};

  const deck = resources["deck"];
  if (deck.constructor.name === "HamiltonDeck") {
    if (Math.abs(y - deck.location.y - 63) < SNAP_MARGIN) {
      snappingLines.resourceY = deck.location.y + 63;
    }

    if (
      Math.abs(y - deck.location.y - 63 - deck.railHeight + height) <
      SNAP_MARGIN
    ) {
      snappingLines.resourceY = deck.location.y + 63 + deck.railHeight - height;
      snappingLines.snappingY = deck.location.y + 63 + deck.railHeight;
    }

    if (Math.abs(x - deck.location.x) < SNAP_MARGIN) {
      snappingLines.resourceX = deck.location.x;
    }

    // Check if the resource is on a Hamilton deck rail. (100 + 22.5 * i)
    for (let rail = 0; rail < deck.num_rails; rail++) {
      const railX = 100 + 22.5 * rail;
      if (Math.abs(x - railX) < SNAP_MARGIN) {
        snappingLines.resourceX = railX;
      }
    }
  }

  // if resource snapping position defined, but not the snapping line, set the snapping line to the
  // resource snapping position.
  if (
    snappingLines.resourceX !== undefined &&
    snappingLines.snappingX === undefined
  ) {
    snappingLines.snappingX = snappingLines.resourceX;
  }
  if (
    snappingLines.resourceY !== undefined &&
    snappingLines.snappingY === undefined
  ) {
    snappingLines.snappingY = snappingLines.resourceY;
  }

  return snappingLines;
}

class Resource {
  constructor(resourceData, parent = undefined) {
    const { name, location, size_x, size_y, size_z, children } = resourceData;
    this.name = name;
    this.size_x = size_x;
    this.size_y = size_y;
    this.size_z = size_z;
    this.location = location;
    this.parent = parent;

    this.color = "#5B6D8F";

    this.children = [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childClass = classForResourceType(child.type);
      const childInstance = new childClass(child, this);
      this.assignChild(childInstance);

      // Save in global lookup
      resources[child.name] = childInstance;
    }
  }

  draggable = true;
  canDelete = true;

  draw(layer) {
    // On draw, destroy the old shape.
    if (this.group !== undefined) {
      this.group.destroy();
    }

    // Add all children to this shape's group.
    this.group = new Konva.Group({
      x: this.location.x,
      y: this.location.y,
      draggable: this.draggable,
    });
    this.mainShape = this.drawMainShape();
    if (this.mainShape !== undefined) {
      this.group.add(this.mainShape);
    }
    for (let i = 0; i < this.children.length; i++) {
      const child = this.children[i];
      child.draw(layer);
    }
    layer.add(this.group);
    // Add a reference to this to the shape (so that it may be accessed in event handlers)
    this.group.resource = this;

    // Add this group to parent group.
    if (this.parent !== undefined) {
      this.parent.group.add(this.group);
    }

    // If a shape is drawn, add event handlers and other things.
    if (this.mainShape !== undefined) {
      this.mainShape.resource = this;
      this.mainShape.on("mouseover", () => {
        const { x, y } = this.getAbsoluteLocation();
        if (tooltip !== undefined) {
          tooltip.destroy();
        }
        tooltip = new Konva.Label({
          x: x + this.size_x / 2,
          y: y + this.size_y / 2,
          opacity: 0.75,
        });
        tooltip.add(
          new Konva.Tag({
            fill: "black",
            pointerDirection: "down",
            pointerWidth: 10,
            pointerHeight: 10,
            lineJoin: "round",
            shadowColor: "black",
            shadowBlur: 10,
            shadowOffset: 10,
            shadowOpacity: 0.5,
          })
        );
        tooltip.add(
          new Konva.Text({
            text: this.tooltipLabel(),
            fontFamily: "Arial",
            fontSize: 18,
            padding: 5,
            fill: "white",
          })
        );
        tooltip.scaleY(-1);
        layer.add(tooltip);
      });
      this.mainShape.on("mouseout", () => {
        tooltip.destroy();
      });
    }
  }

  drawMainShape() {
    return new Konva.Rect({
      width: this.size_x,
      height: this.size_y,
      fill: this.color,
      stroke: "black",
      strokeWidth: 1,
    });
  }

  tooltipLabel() {
    return `${this.name} (${this.constructor.name})`;
  }

  getAbsoluteLocation() {
    if (this.parent !== undefined) {
      const parentLocation = this.parent.getAbsoluteLocation();
      return {
        x: parentLocation.x + this.location.x,
        y: parentLocation.y + this.location.y,
        z: parentLocation.z + this.location.z,
      };
    }
    return this.location;
  }

  serialize() {
    const serializedChildren = [];
    for (let i = 0; i < this.children.length; i++) {
      const child = this.children[i];
      serializedChildren.push(child.serialize());
    }

    return {
      name: this.name,
      type: this.constructor.name,
      location: {
        ...this.location,
        ...{
          type: "Coordinate",
        },
      },
      size_x: this.size_x,
      size_y: this.size_y,
      size_z: this.size_z,
      children: serializedChildren,
      parent_name: this.parent === undefined ? null : this.parent.name,
    };
  }

  assignChild(child) {
    if (child === this) {
      console.error("Cannot assign a resource to itself", this);
      return;
    }

    // Update layout tree.
    child.parent = this;
    this.children.push(child);

    // Add child group to UI.
    if (this.group !== undefined && child.group !== undefined) {
      this.group.add(child.group);
    }
  }

  unassignChild(child) {
    child.parent = undefined;
    const index = this.children.indexOf(child);
    if (index > -1) {
      this.children.splice(index, 1);
    }
  }

  destroy() {
    // Destroy children
    for (let i = this.children.length - 1; i >= 0; i--) {
      const child = this.children[i];
      child.destroy();
    }

    // Remove from global lookup
    delete resources[this.name];

    // Remove from UI
    if (this.group !== undefined) {
      this.group.destroy();
    }

    // Remove from parent
    if (this.parent !== undefined) {
      this.parent.unassignChild(this);
    }
  }

  update() {
    this.draw(resourceLayer);
  }
}

class Deck extends Resource {
  draggable = false;
  canDelete = false;
}

class HamiltonDeck extends Deck {
  constructor(resourceData) {
    super(resourceData, undefined);
    const { num_rails } = resourceData;
    this.num_rails = num_rails;
    this.railHeight = 497;
  }

  drawMainShape() {
    // Draw a transparent rectangle with an outline
    let mainShape = new Konva.Group();
    mainShape.add(
      new Konva.Rect({
        y: 63,
        width: this.size_x,
        height: this.railHeight,
        fill: "white",
        stroke: "black",
        strokeWidth: 1,
      })
    );
    // Draw vertical rails as lines
    for (let i = 0; i < numRails; i++) {
      const rail = new Konva.Line({
        points: [
          100 + i * 22.5, // 22.5 mm per rail
          63,
          100 + i * 22.5, // 22.5 mm per rail
          this.railHeight + 63,
        ],
        stroke: "black",
        strokeWidth: 1,
      });
      mainShape.add(rail);

      // Add a text label every 5 rails. Rails are 1-indexed.
      // Keep in mind that the stage is flipped vertically.
      if ((i + 1) % 5 === 0) {
        const railLabel = new Konva.Text({
          x: 100 + i * 22.5, // 22.5 mm per rail
          y: 50,
          text: i + 1,
          fontSize: 12,
          fill: "black",
        });
        railLabel.scaleY(-1); // Flip the text vertically
        mainShape.add(railLabel);
      }
    }
    return mainShape;
  }

  serialize() {
    return {
      ...super.serialize(),
      ...{
        num_rails: this.num_rails,
        no_trash: true,
      },
    };
  }
}

const otDeckSiteLocations = [
  { x: 0.0, y: 0.0 },
  { x: 132.5, y: 0.0 },
  { x: 265.0, y: 0.0 },
  { x: 0.0, y: 90.5 },
  { x: 132.5, y: 90.5 },
  { x: 265.0, y: 90.5 },
  { x: 0.0, y: 181.0 },
  { x: 132.5, y: 181.0 },
  { x: 265.0, y: 181.0 },
  { x: 0.0, y: 271.5 },
  { x: 132.5, y: 271.5 },
  { x: 265.0, y: 271.5 },
];

class OTDeck extends Deck {
  constructor(resourceData) {
    resourceData.location = { x: 115.65, y: 68.03 };
    super(resourceData, undefined);
  }

  drawMainShape() {
    let group = new Konva.Group({});
    const width = 128.0;
    const height = 86.0;
    // Draw the sites
    for (let i = 0; i < otDeckSiteLocations.length; i++) {
      const siteLocation = otDeckSiteLocations[i];
      const site = new Konva.Rect({
        x: siteLocation.x,
        y: siteLocation.y,
        width: width,
        height: height,
        fill: "white",
        stroke: "black",
        strokeWidth: 1,
      });
      group.add(site);

      // Add a text label in the site
      const siteLabel = new Konva.Text({
        x: siteLocation.x,
        y: siteLocation.y + height,
        text: i + 1,
        width: width,
        height: height,
        fontSize: 16,
        fill: "black",
        align: "center",
        verticalAlign: "middle",
        scaleY: -1, // Flip the text vertically
      });
      group.add(siteLabel);
    }
    return group;
  }

  serialize() {
    return {
      ...super.serialize(),
      ...{
        no_trash: true,
      },
    };
  }
}

let snapLines = [];
let snappingBox = undefined;

class Plate extends Resource {
  constructor(resourceData, parent = undefined) {
    super(resourceData, parent);
    const { num_items_x, num_items_y } = resourceData;
    this.num_items_x = num_items_x;
    this.num_items_y = num_items_y;
  }

  drawMainShape() {
    return new Konva.Rect({
      width: this.size_x,
      height: this.size_y,
      fill: "#2B2D42",
      stroke: "black",
      strokeWidth: 1,
    });
  }

  serialize() {
    return {
      ...super.serialize(),
      ...{
        num_items_x: this.num_items_x,
        num_items_y: this.num_items_y,
      },
    };
  }

  update() {
    super.update();

    // Rename the children
    for (let i = 0; i < this.num_items_x; i++) {
      for (let j = 0; j < this.num_items_y; j++) {
        const child = this.children[i * this.num_items_y + j];
        child.name = `${this.name}_well_${i}_${j}`;
      }
    }
  }
}

class Container extends Resource {
  constructor(resourceData, parent) {
    super(resourceData, parent);
    const { max_volume } = resourceData;
    this.maxVolume = max_volume;
    this.liquids = resourceData.liquids || [];
  }

  static colorForVolume(volume, maxVolume) {
    return `rgba(239, 35, 60, ${volume / maxVolume})`;
  }

  getVolume() {
    return this.liquids.reduce((acc, liquid) => acc + liquid.volume, 0);
  }

  aspirate(volume) {
    if (volume > this.getVolume()) {
      throw new Error(
        `Aspirating ${volume}uL from well ${this.name} with ${this.volume}uL`
      );
    }

    // Remove liquids top down until we have removed the desired volume.
    let volumeToRemove = volume;
    for (let i = this.liquids.length - 1; i >= 0; i--) {
      const liquid = this.liquids[i];
      if (volumeToRemove >= liquid.volume) {
        volumeToRemove -= liquid.volume;
        this.liquids.splice(i, 1);
      } else {
        liquid.volume -= volumeToRemove;
        volumeToRemove = 0;
      }
    }

    this.update();
  }

  addLiquid(liquid) {
    this.liquids.push(liquid);
    this.update();
  }

  dispense(volume) {
    if (volume + this.volume > this.maxVolume) {
      throw new Error(
        `Adding ${volume}uL to well ${this.name} with ${this.volume}uL would exceed max volume of ${this.maxVolume}uL`
      );
    }

    this.addLiquid({
      volume: volume,
      name: "Unknown liquid", // TODO: get liquid name from parameter?
    });
  }

  serializeState() {
    return {
      liquids: this.liquids,
      pending_liquids: this.liquids,
    };
  }

  serialize() {
    return {
      ...super.serialize(),
      ...{
        max_volume: this.maxVolume,
      },
    };
  }
}

class Well extends Container {
  draggable = false;
  canDelete = false;

  drawMainShape() {
    return new Konva.Circle({
      radius: this.size_x / 2,
      fill: Well.colorForVolume(this.getVolume(), this.maxVolume),
      stroke: "black",
      strokeWidth: 1,
      offsetX: -this.size_x / 2,
      offsetY: -this.size_y / 2,
    });
  }
}

class TipRack extends Resource {
  constructor(resourceData, parent) {
    super(resourceData, parent);
    const { num_items_x, num_items_y } = resourceData;
    this.num_items_x = num_items_x;
    this.num_items_y = num_items_y;
  }

  drawMainShape() {
    return new Konva.Rect({
      width: this.size_x,
      height: this.size_y,
      fill: "#2B2D42",
      stroke: "black",
      strokeWidth: 1,
    });
  }

  serialize() {
    return {
      ...super.serialize(),
      ...{
        num_items_x: this.num_items_x,
        num_items_y: this.num_items_y,
      },
    };
  }

  update() {
    super.update();

    // Rename the children
    for (let i = 0; i < this.num_items_x; i++) {
      for (let j = 0; j < this.num_items_y; j++) {
        const child = this.children[i * this.num_items_y + j];
        child.name = `${this.name}_tipspot_${i}_${j}`;
      }
    }
  }
}

class TipSpot extends Resource {
  constructor(resourceData, parent) {
    super(resourceData, parent);
    this.has_tip = false;
    this.tip = resourceData.prototype_tip; // not really a creator, but good enough for now.
  }

  draggable = false;
  canDelete = false;

  drawMainShape() {
    return new Konva.Circle({
      radius: this.size_x / 2,
      fill: this.has_tip ? "#40CDA1" : "white",
      stroke: "black",
      strokeWidth: 1,
      offsetX: -this.size_x / 2,
      offsetY: -this.size_y / 2,
    });
  }

  setTip(has_tip, layer) {
    this.has_tip = has_tip;
    this.draw(layer);
  }

  pickUpTip(layer) {
    if (!this.has_tip) {
      throw new Error("No tip to pick up");
    }
    this.setTip(false, layer);
  }

  dropTip(layer) {
    if (this.has_tip) {
      throw new Error("Already has tip");
    }
    this.setTip(true, layer);
  }

  serialize() {
    return {
      ...super.serialize(),
      ...{
        prototype_tip: this.tip,
      },
    };
  }

  serializeState() {
    if (this.has_tip) {
      return {
        tip: this.tip,
        pending_tip: this.tip,
      };
    }
    return {
      tip: null,
      pending_tip: null,
    };
  }
}

// Nothing special.
class Trash extends Resource {
  drawMainShape() {
    if (resources["deck"].constructor.name) {
      return undefined;
    }
    return super.drawMainShape();
  }
}

// Nothing special.
class Carrier extends Resource {}
class PlateCarrier extends Carrier {}
class TipCarrier extends Carrier {}

class CarrierSite extends Resource {
  constructor(resourceData, parent) {
    super(resourceData, parent);
    const { spot } = resourceData;
    this.spot = spot;
  }

  draggable = false;
  canDelete = false;

  serialize() {
    return {
      ...super.serialize(),
      ...{
        spot: this.spot,
      },
    };
  }
}

function moveToTop(resource) {
  // Recursively move the resource to the top of the layer.
  resource.group.moveToTop();
  if (resource.parent !== undefined) {
    moveToTop(resource.parent);
  }
}

resourceLayer.on("dragstart", (e) => {
  // Move dragged resource to top of layer
  let resource = e.target.resource;
  moveToTop(resource);

  // Show the trash icon
  resourceLayer.add(trash);
  trash.moveToTop();
});

function _deleteSnappingLines() {
  if (snapLines.length > 0) {
    for (let i = snapLines.length - 1; i >= 0; i--) {
      snapLines[i].destroy();
      snapLines.splice(i, 1);
    }
  }

  if (snappingBox !== undefined) {
    snappingBox.destroy();
  }
}

resourceLayer.on("dragmove", (e) => {
  if (tooltip !== undefined) {
    tooltip.destroy();
  }

  _deleteSnappingLines();

  // Get the absolute location of this resource in this drag. We replace the resource's relative
  // location with its drag location (drag is relative to the parent too).
  let resource = e.target.resource;
  x = resource.parent.getAbsoluteLocation().x + e.target.position().x;
  y = resource.parent.getAbsoluteLocation().y + e.target.position().y;

  // If we have a snapping box match, draw a snapping box indicator around the area.
  const snapResult = getSnappingResourceAndLocationAndSnappingBox(
    resource,
    x + resource.size_x / 2,
    y + resource.size_y / 2
  );

  if (snapResult !== undefined) {
    let {
      snappingBox: { x: snapX, y: snapY, width, height },
    } = snapResult;

    snappingBox = new Konva.Rect({
      x: snapX,
      y: snapY,
      width: width,
      height: height,
      fill: "rgba(0, 0, 0, 0.1)",
      stroke: "red",
      strokeWidth: 1,
      dash: [10, 5],
    });
    resourceLayer.add(snappingBox);
  } else {
    // If there is no box snapping match, check if there is a grid snapping match.
    let { snappingX, snappingY, resourceX, resourceY } = getSnappingGrid(
      x,
      y,
      resource.size_x,
      resource.size_y
    );

    // If we have a snapping match, show an indicator and snap to the grid.
    if (snappingX !== undefined) {
      e.target.x(resourceX - resource.parent.getAbsoluteLocation().x);

      // Draw a vertical line
      let snapLine = new Konva.Line({
        points: [snappingX, 0, snappingX, canvasHeight],
        stroke: "red",
        strokeWidth: 2,
        dash: [10, 5],
      });
      resourceLayer.add(snapLine);
      snapLines.push(snapLine);
    }
    if (snappingY !== undefined) {
      e.target.y(resourceY - resource.parent.getAbsoluteLocation().y);

      // Draw a vertical line
      let snapLine = new Konva.Line({
        points: [0, snappingY, canvasWidth, snappingY],
        stroke: "red",
        strokeWidth: 2,
        dash: [10, 5],
      });
      resourceLayer.add(snapLine);
      snapLines.push(snapLine);
    }
  }
});

resourceLayer.on("dragend", (e) => {
  _deleteSnappingLines();

  // Get the absolute location of this resource in this drag. We replace the resource's relative
  // location with its drag location (drag is relative to the parent too).
  let resource = e.target.resource;
  x = resource.parent.getAbsoluteLocation().x + e.target.position().x;
  y = resource.parent.getAbsoluteLocation().y + e.target.position().y;

  const snapResult = getSnappingResourceAndLocationAndSnappingBox(
    resource,
    x + resource.size_x / 2,
    y + resource.size_y / 2
  );

  if (snapResult !== undefined) {
    const { resource: parent, location } = snapResult;

    if (parent === trash) {
      // Delete the plate.
      resource.destroy();
    } else {
      const { x, y } = location;

      // Update the deck layout with the new parent.
      if (resource.parent !== undefined) {
        resource.parent.unassignChild(resource);
      }
      resource.location = { x: x, y: y, z: 0 };
      parent.assignChild(resource);

      // Snap to position in UI after it has been added to the new UI group by assignChild.
      e.target.position({ x: x, y: y });
    }
  } else {
    // Update the deck layout with the new location.
    resource.location.x = x;
    resource.location.y = y;
    // Assign resource to deck.
    if (resource.parent !== undefined) {
      resource.parent.unassignChild(resource);
    }
    resources["deck"].assignChild(resource);
    e.target.position({ x: x, y: y });
  }

  // hide the trash icon
  trash.remove();

  autoSave();
});

function selectResource(resource) {
  selectedResource = resource;
  loadEditor(selectedResource);

  // Draw a selection box around the resource.
  selectedResource.mainShape.stroke("orange");
  selectedResource.mainShape.strokeWidth(1);
  selectedResource.mainShape.strokeEnabled(true);
}

function unselectResource() {
  closeRightSidebar();
  closeContextMenu();

  if (selectedResource !== undefined) {
    // Redraw the resource layer to remove the selection box.
    selectedResource.draw(resourceLayer);
  }

  selectedResource = undefined;
}

function handleClick(e) {
  // ignore if it is a context menu click
  if (e.evt.button === 2) {
    return;
  }

  if (tooltip !== undefined) {
    tooltip.destroy();
  }

  let resourceClicked = e.target.resource;

  if (resourceClicked === undefined) {
    // If the user clicked on the background, unselect the current resource.
    unselectResource();
  } else if (resourceClicked === selectedResource) {
    // If the user clicked on the selected resource, unselect it.
    unselectResource();
  } else if (
    ["HamiltonDeck", "OTDeck", "Deck"].includes(
      resourceClicked.constructor.name
    )
  ) {
    // The deck cannot be selected. If the user clicks on it, unselect the current resource.
    unselectResource();
  } else {
    unselectResource();
    // Select the resource.
    selectResource(resourceClicked);
  }
}

// on right click, show options
resourceLayer.on("contextmenu", (e) => {
  e.evt.preventDefault();
  selectedResource = e.target.resource;

  // If the resource is not the trash, show the context menu.
  if (selectResource !== trash) {
    openContextMenu();
  }
});

function classForResourceType(type) {
  switch (type) {
    case "Deck":
      return Deck;
    case "HamiltonDeck":
      return HamiltonDeck;
    case "Trash":
      return Trash;
    case "OTDeck":
      return OTDeck;
    case "Plate":
      return Plate;
    case "Well":
      return Well;
    case "TipRack":
      return TipRack;
    case "TipSpot":
      return TipSpot;
    case "CarrierSite":
      return CarrierSite;
    case "Carrier":
      return Carrier;
    case "PlateCarrier":
      return PlateCarrier;
    case "TipCarrier":
      return TipCarrier;
    case "Container":
      return Container;
    default:
      return Resource;
  }
}

function loadResource(resourceData) {
  const resourceClass = classForResourceType(resourceData.type);

  const parentName = resourceData.parent_name;
  var parent = undefined;
  if (parentName !== undefined) {
    parent = resources[parentName];
  }

  const resource = new resourceClass(resourceData, parent);
  resources[resource.name] = resource;

  return resource;
}

// ===========================================================================
// init
// ===========================================================================

function scaleStage(stage) {
  const canvas = document.getElementById("kanvas");
  canvasWidth = canvas.offsetWidth;
  canvasHeight = canvas.offsetHeight;

  scaleX = canvasWidth / robotWidthMM;
  scaleY = canvasHeight / robotHeightMM;

  const effectiveScale = Math.min(scaleX, scaleY);

  stage.scaleX(effectiveScale);
  stage.scaleY(-1 * effectiveScale);
  stage.offsetY(canvasHeight / effectiveScale);
}

window.addEventListener("load", function () {
  const canvas = document.getElementById("kanvas");
  canvasWidth = canvas.offsetWidth;
  canvasHeight = canvas.offsetHeight;

  stage = new Konva.Stage({
    container: "kanvas",
    width: canvasWidth,
    height: canvasHeight,
  });

  scaleStage(stage);

  // Add click handler to stage
  stage.on("click", handleClick);

  // add the layer to the stage
  stage.add(layer);
  stage.add(resourceLayer);

  // add a trash icon for deleting resources
  var imageObj = new Image();
  trash = new Konva.Image({
    x: 700,
    y: 100,
    image: imageObj,
    width: 50,
    height: 50,
  });
  imageObj.src = "/trash3.svg";
  // Flip the image vertically in place
  trash.scaleY(-1);
  trash.offsetY(50);
});

window.addEventListener("resize", function () {
  scaleStage(stage);
});
